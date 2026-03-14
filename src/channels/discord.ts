import fs from 'fs';
import https from 'https';
import http from 'http';
import path from 'path';

import { AttachmentBuilder, Client, Events, GatewayIntentBits, Message, TextChannel } from 'discord.js';

import { ASSISTANT_NAME, GROUPS_DIR, TRIGGER_PATTERN } from '../config.js';
import { logger } from '../logger.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

export interface DiscordChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class DiscordChannel implements Channel {
  name = 'discord';

  private client: Client | null = null;
  private opts: DiscordChannelOpts;
  private botToken: string;
  // botName: when set, JIDs use dc:BOTNAME:CHANNEL_ID format (multi-bot mode).
  // When null, legacy dc:CHANNEL_ID format is used (single-bot mode).
  private botName: string | null;

  constructor(botToken: string, opts: DiscordChannelOpts, botName?: string) {
    this.botToken = botToken;
    this.opts = opts;
    this.botName = botName || null;
  }

  private makeJid(channelId: string): string {
    return this.botName ? `dc:${this.botName}:${channelId}` : `dc:${channelId}`;
  }

  private channelIdFromJid(jid: string): string {
    if (this.botName) return jid.slice(`dc:${this.botName}:`.length);
    return jid.replace(/^dc:/, '');
  }

  async connect(): Promise<void> {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      // Ignore bot messages (including own)
      if (message.author.bot) return;

      const channelId = message.channelId;
      const chatJid = this.makeJid(channelId);
      let content = message.content;
      const timestamp = message.createdAt.toISOString();
      const senderName =
        message.member?.displayName ||
        message.author.displayName ||
        message.author.username;
      const sender = message.author.id;
      const msgId = message.id;

      // Determine chat name
      let chatName: string;
      if (message.guild) {
        const textChannel = message.channel as TextChannel;
        chatName = `${message.guild.name} #${textChannel.name}`;
      } else {
        chatName = senderName;
      }

      // Translate Discord @bot mentions into TRIGGER_PATTERN format.
      // Discord mentions look like <@botUserId> — these won't match
      // TRIGGER_PATTERN (e.g., ^@Andy\b), so we prepend the trigger
      // when the bot is @mentioned.
      if (this.client?.user) {
        const botId = this.client.user.id;
        const isBotMentioned =
          message.mentions.users.has(botId) ||
          content.includes(`<@${botId}>`) ||
          content.includes(`<@!${botId}>`) ||
          message.mentions.everyone; // covers @everyone and @here

        if (isBotMentioned) {
          // Strip the <@botId> mention to avoid visual clutter
          content = content
            .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
            .trim();
          // Prepend trigger if not already present
          if (!TRIGGER_PATTERN.test(content)) {
            content = `@${ASSISTANT_NAME} ${content}`;
          }
        }
      }

      // Handle attachments — download to group downloads folder so agent can access them
      if (message.attachments.size > 0) {
        const group = this.opts.registeredGroups()[chatJid];
        const attachmentDescriptions = await Promise.all(
          [...message.attachments.values()].map(async (att) => {
            const contentType = att.contentType || '';
            const typeLabel = contentType.startsWith('image/')
              ? 'Image'
              : contentType.startsWith('video/')
                ? 'Video'
                : contentType.startsWith('audio/')
                  ? 'Audio'
                  : 'File';

            if (group && att.url) {
              try {
                const downloadsDir = path.join(GROUPS_DIR, group.folder, 'downloads');
                fs.mkdirSync(downloadsDir, { recursive: true });
                const safeName = (att.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
                const destName = `${Date.now()}-${safeName}`;
                const destPath = path.join(downloadsDir, destName);
                await downloadFile(att.url, destPath);
                return `[${typeLabel}: ${att.name || 'file'} — saved to /workspace/group/downloads/${destName}]`;
              } catch (dlErr) {
                logger.warn({ att: att.name, err: dlErr }, 'Failed to download Discord attachment');
              }
            }
            return `[${typeLabel}: ${att.name || 'file'}]`;
          }),
        );
        if (content) {
          content = `${content}\n${attachmentDescriptions.join('\n')}`;
        } else {
          content = attachmentDescriptions.join('\n');
        }
      }

      // Handle reply context — include who the user is replying to
      if (message.reference?.messageId) {
        try {
          const repliedTo = await message.channel.messages.fetch(
            message.reference.messageId,
          );
          const replyAuthor =
            repliedTo.member?.displayName ||
            repliedTo.author.displayName ||
            repliedTo.author.username;
          content = `[Reply to ${replyAuthor}] ${content}`;
        } catch {
          // Referenced message may have been deleted
        }
      }

      // Store chat metadata for discovery
      this.opts.onChatMetadata(chatJid, timestamp, chatName);

      // Only deliver full message for registered groups
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        logger.debug(
          { chatJid, chatName },
          'Message from unregistered Discord channel',
        );
        return;
      }

      // Deliver message — startMessageLoop() will pick it up
      this.opts.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
      });

      logger.info(
        { chatJid, chatName, sender: senderName },
        'Discord message stored',
      );
    });

    // Handle errors gracefully
    this.client.on(Events.Error, (err) => {
      logger.error({ err: err.message }, 'Discord client error');
    });

    return new Promise<void>((resolve) => {
      this.client!.once(Events.ClientReady, (readyClient) => {
        logger.info(
          { username: readyClient.user.tag, id: readyClient.user.id },
          'Discord bot connected',
        );
        console.log(`\n  Discord bot: ${readyClient.user.tag}`);
        console.log(
          `  Use /chatid command or check channel IDs in Discord settings\n`,
        );
        resolve();
      });

      this.client!.login(this.botToken);
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.client) {
      logger.warn('Discord client not initialized');
      return;
    }

    try {
      const channelId = this.channelIdFromJid(jid);
      const channel = await this.client.channels.fetch(channelId);

      if (!channel || !('send' in channel)) {
        logger.warn({ jid }, 'Discord channel not found or not text-based');
        return;
      }

      const textChannel = channel as TextChannel;

      // Discord has a 2000 character limit per message — split if needed
      const MAX_LENGTH = 2000;
      if (text.length <= MAX_LENGTH) {
        await textChannel.send(text);
      } else {
        for (let i = 0; i < text.length; i += MAX_LENGTH) {
          await textChannel.send(text.slice(i, i + MAX_LENGTH));
        }
      }
      logger.info({ jid, length: text.length }, 'Discord message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Discord message');
    }
  }

  isConnected(): boolean {
    return this.client !== null && this.client.isReady();
  }

  ownsJid(jid: string): boolean {
    if (this.botName) return jid.startsWith(`dc:${this.botName}:`);
    // Legacy single-bot mode: own any dc: JID that is NOT in named format
    return jid.startsWith('dc:') && !jid.match(/^dc:[^:]+:[^:]+/);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      logger.info('Discord bot stopped');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.client || !isTyping) return;
    try {
      const channelId = this.channelIdFromJid(jid);
      const channel = await this.client.channels.fetch(channelId);
      if (channel && 'sendTyping' in channel) {
        await (channel as TextChannel).sendTyping();
      }
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Discord typing indicator');
    }
  }

  async sendFile(jid: string, filePath: string, filename?: string): Promise<void> {
    if (!this.client) {
      logger.warn('Discord client not initialized');
      return;
    }
    try {
      const channelId = this.channelIdFromJid(jid);
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !('send' in channel)) {
        logger.warn({ jid }, 'Discord channel not found or not text-based');
        return;
      }
      const attachment = new AttachmentBuilder(filePath, {
        name: filename || path.basename(filePath),
      });
      await (channel as TextChannel).send({ files: [attachment] });
      logger.info({ jid, filePath }, 'Discord file sent');
    } catch (err) {
      logger.error({ jid, filePath, err }, 'Failed to send Discord file');
    }
  }

  async reactToMessage(jid: string, messageId: string, emoji: string): Promise<void> {
    if (!this.client) {
      logger.warn('Discord client not initialized');
      return;
    }
    try {
      const channelId = this.channelIdFromJid(jid);
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !('messages' in channel)) {
        logger.warn({ jid }, 'Discord channel not found or not text-based');
        return;
      }
      const msg = await (channel as TextChannel).messages.fetch(messageId);
      await msg.react(emoji);
      logger.info({ jid, messageId, emoji }, 'Discord reaction added');
    } catch (err) {
      logger.error({ jid, messageId, emoji, err }, 'Failed to add Discord reaction');
    }
  }
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    proto.get(url, (res) => {
      // Follow redirects up to 3 times
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(destPath);
        downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}
