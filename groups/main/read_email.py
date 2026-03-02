#!/usr/bin/env python3
import imaplib
import email
from email.header import decode_header
import sys
import re

def get_gmail_config():
    """读取Gmail配置"""
    with open('/workspace/group/.gmail_config', 'r') as f:
        config = {}
        for line in f:
            if '=' in line:
                key, value = line.strip().split('=', 1)
                config[key] = value
    return config

def search_and_read_email(search_term):
    """搜索并读取邮件完整内容"""
    config = get_gmail_config()
    gmail_address = config['GMAIL_ADDRESS']
    gmail_password = config['GMAIL_APP_PASSWORD']
    
    try:
        mail = imaplib.IMAP4_SSL('imap.gmail.com')
        mail.login(gmail_address, gmail_password)
        mail.select('inbox')
        
        # 搜索包含关键词的邮件
        status, messages = mail.search(None, f'(SUBJECT "{search_term}")')
        email_ids = messages[0].split()
        
        if not email_ids:
            print(f"未找到包含 '{search_term}' 的邮件")
            mail.logout()
            return
        
        # 读取最新的一封
        latest_email_id = email_ids[-1]
        status, msg_data = mail.fetch(latest_email_id, '(RFC822)')
        msg = email.message_from_bytes(msg_data[0][1])
        
        # 解码主题
        subject = decode_header(msg['Subject'])[0][0]
        if isinstance(subject, bytes):
            subject = subject.decode()
        
        from_addr = msg.get('From')
        date = msg.get('Date')
        
        print(f"━━━━━━━━━━━━━━━━━━━━━━━━━━")
        print(f"📩 发件人: {from_addr}")
        print(f"📝 主题: {subject}")
        print(f"📅 日期: {date}")
        print(f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
        
        # 获取邮件正文
        body_text = ""
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                if content_type == 'text/plain':
                    try:
                        body_text = part.get_payload(decode=True).decode()
                        break
                    except:
                        pass
                elif content_type == 'text/html' and not body_text:
                    try:
                        body_text = part.get_payload(decode=True).decode()
                    except:
                        pass
        else:
            try:
                body_text = msg.get_payload(decode=True).decode()
            except:
                pass
        
        print("💬 邮件内容:")
        print(body_text)
        
        mail.logout()
        
    except Exception as e:
        print(f"❌ 读取邮件失败: {str(e)}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: python3 read_email.py <搜索关键词>")
        sys.exit(1)
    
    search_term = sys.argv[1]
    search_and_read_email(search_term)
