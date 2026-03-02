#!/bin/bash

# 加载配置
source /workspace/group/.twitter_api_config

# 发推文函数
post_tweet() {
    local text="$1"
    
    # 准备JSON payload
    local payload=$(cat <<JSON
{"text": "$text"}
JSON
)
    
    # 生成OAuth签名并发送请求（使用tweepy或直接curl）
    # 由于OAuth1签名复杂，这里先用简单测试
    
    echo "📝 准备发送推文: $text"
    echo "⚠️ 需要OAuth1签名，建议使用Python库"
}

# 搜索推文函数
search_tweets() {
    local query="$1"
    
    curl -s -X GET \
        "https://api.twitter.com/2/tweets/search/recent?query=$(echo "$query" | jq -sRr @uri)&max_results=10" \
        -H "Authorization: Bearer $TWITTER_BEARER_TOKEN" \
        | jq -r '.data[]? | "━━━━━━━━━━━━━━━━━━━━━━\n📝 \(.text)\n📅 \(.created_at)\n"'
}

# 主函数
case "$1" in
    search)
        search_tweets "$2"
        ;;
    *)
        echo "用法: $0 search <关键词>"
        ;;
esac
