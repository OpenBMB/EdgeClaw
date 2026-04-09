#!/bin/bash
# Scrape latest tweet from X via xcancel.com proxy
# Usage: ./scrape-tweet.sh <username> [output_dir]
# Output: JSON with tweet text, date, stats, avatar URL, tweet URL

USERNAME="${1:?Usage: scrape-tweet.sh <username> [output_dir]}"
OUTPUT_DIR="${2:-/tmp/xhs}"

mkdir -p "$OUTPUT_DIR"

PAGE="$OUTPUT_DIR/xcancel-page.html"
curl -s -L -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  "https://xcancel.com/$USERNAME" > "$PAGE"

python3 -c "
import sys, re, html, json

with open('$PAGE') as f:
    content = f.read()

# Find first non-retweet timeline item
items = re.split(r'<div class=\"timeline-item \"', content)[1:]
for item_html in items:
    if 'retweet-header' in item_html and 'Pinned Tweet' not in item_html:
        continue
    
    text_m = re.search(r'<div class=\"tweet-content media-body\"[^>]*>(.*?)</div>', item_html, re.DOTALL)
    date_m = re.search(r'<span class=\"tweet-date\"><a[^>]*title=\"([^\"]+)\"', item_html)
    link_m = re.search(r'<a class=\"tweet-link\" href=\"([^\"]+)\"', item_html)
    avatar_m = re.search(r'<img class=\"avatar[^\"]*\" src=\"([^\"]+)\"', item_html)
    
    stats = re.findall(r'<span class=\"icon-(comment|retweet|heart|views)\"[^>]*></span>\s*([\d,]+)', item_html)
    
    if text_m:
        text = re.sub(r'<[^>]+>', '', text_m.group(1)).strip()
        tweet = {
            'username': '$USERNAME',
            'text': html.unescape(text),
            'date': date_m.group(1) if date_m else '',
            'url': 'https://x.com' + link_m.group(1).replace('#m','') if link_m else '',
            'avatar_url': avatar_m.group(1).replace('_bigger', '_400x400') if avatar_m else '',
            'stats': {s[0]: s[1] for s in stats}
        }
        print(json.dumps(tweet, ensure_ascii=False, indent=2))
        break
" > "$OUTPUT_DIR/tweet.json"

# Download avatar
AVATAR_URL=$(python3 -c "import json; d=json.load(open('$OUTPUT_DIR/tweet.json')); print(d.get('avatar_url',''))")
if [ -n "$AVATAR_URL" ]; then
  curl -s -o "$OUTPUT_DIR/avatar.jpg" "$AVATAR_URL"
fi

echo "Tweet data saved to $OUTPUT_DIR/tweet.json"
echo "Avatar saved to $OUTPUT_DIR/avatar.jpg"
