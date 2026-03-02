#!/usr/bin/env python3
import imaplib
import email
from email.header import decode_header
import sys

def get_gmail_config():
    """读取Gmail配置"""
    with open('/workspace/group/.gmail_config', 'r') as f:
        config = {}
        for line in f:
            if '=' in line:
                key, value = line.strip().split('=', 1)
                config[key] = value
    return config

def check_unread_emails():
    """检查未读邮件"""
    config = get_gmail_config()
    gmail_address = config['GMAIL_ADDRESS']
    gmail_password = config['GMAIL_APP_PASSWORD']
    
    try:
        # 连接到Gmail IMAP服务器
        mail = imaplib.IMAP4_SSL('imap.gmail.com')
        mail.login(gmail_address, gmail_password)
        mail.select('inbox')
        
        # 搜索未读邮件
        status, messages = mail.search(None, 'UNSEEN')
        email_ids = messages[0].split()
        
        if not email_ids:
            print("📬 没有未读邮件")
            mail.logout()
            return
        
        print(f"📧 你有 {len(email_ids)} 封未读邮件：\n")
        
        # 获取最近10封未读邮件
        for email_id in email_ids[-10:]:
            status, msg_data = mail.fetch(email_id, '(RFC822)')
            msg = email.message_from_bytes(msg_data[0][1])
            
            # 解码主题
            subject = decode_header(msg['Subject'])[0][0]
            if isinstance(subject, bytes):
                subject = subject.decode()
            
            # 发件人
            from_addr = msg.get('From')
            
            # 日期
            date = msg.get('Date')
            
            print(f"━━━━━━━━━━━━━━━━━━━━━━━━━━")
            print(f"📩 发件人: {from_addr}")
            print(f"📝 主题: {subject}")
            print(f"📅 日期: {date}")
            
            # 获取邮件正文
            if msg.is_multipart():
                for part in msg.walk():
                    content_type = part.get_content_type()
                    if content_type == 'text/plain':
                        try:
                            body = part.get_payload(decode=True).decode()
                            # 只显示前200个字符
                            preview = body[:200].strip()
                            if len(body) > 200:
                                preview += "..."
                            print(f"💬 内容预览:\n{preview}")
                        except:
                            pass
                        break
            else:
                try:
                    body = msg.get_payload(decode=True).decode()
                    preview = body[:200].strip()
                    if len(body) > 200:
                        preview += "..."
                    print(f"💬 内容预览:\n{preview}")
                except:
                    pass
            
            print()
        
        if len(email_ids) > 10:
            print(f"... 还有 {len(email_ids) - 10} 封未读邮件")
        
        mail.logout()
        
    except Exception as e:
        print(f"❌ 检查邮件失败: {str(e)}")

if __name__ == '__main__':
    check_unread_emails()
