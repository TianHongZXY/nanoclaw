#!/usr/bin/env python3
import smtplib
import sys
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def send_email(to_email, subject, body):
    """发送邮件"""
    # 读取配置
    with open('/workspace/group/.gmail_config', 'r') as f:
        config = {}
        for line in f:
            if '=' in line:
                key, value = line.strip().split('=', 1)
                config[key] = value
    
    gmail_address = config['GMAIL_ADDRESS']
    gmail_password = config['GMAIL_APP_PASSWORD']
    
    # 添加注脚
    signature = "\n\n---\n📧 由 Xinyu 的 OpenClaw 智能助理编辑发送"
    full_body = body + signature
    
    # 创建邮件
    msg = MIMEMultipart()
    msg['From'] = gmail_address
    msg['To'] = to_email
    msg['Subject'] = subject
    
    msg.attach(MIMEText(full_body, 'plain', 'utf-8'))
    
    # 发送邮件
    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(gmail_address, gmail_password)
        server.send_message(msg)
        server.quit()
        print(f"✅ 邮件发送成功！")
        print(f"收件人: {to_email}")
        print(f"主题: {subject}")
        return True
    except Exception as e:
        print(f"❌ 发送失败: {str(e)}")
        return False

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("用法: python3 send_email.py <收件人> <主题> <正文>")
        sys.exit(1)
    
    to_email = sys.argv[1]
    subject = sys.argv[2]
    body = sys.argv[3]
    
    send_email(to_email, subject, body)
