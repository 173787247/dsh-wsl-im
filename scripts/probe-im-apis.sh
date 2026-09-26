#!/usr/bin/env bash
set -euo pipefail
set -a
# shellcheck disable=SC1090
source <(tr -d '\r' < "${HOME}/.dsh/dsh-wsl-im.env")
set +a

proxy_args=()
if [[ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]]; then
  proxy_args=(-x "${HTTPS_PROXY:-$https_proxy}")
fi

echo "=== Slack auth.test ==="
curl -sS "${proxy_args[@]}" -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" \
  https://slack.com/api/auth.test | python3 -c 'import sys,json; d=json.load(sys.stdin); print("ok=",d.get("ok"),"user=",d.get("user"),"error=",d.get("error"))'

echo "=== Discord @me ==="
code=$(curl -sS "${proxy_args[@]}" -o /tmp/discord-me.json -w '%{http_code}' \
  -H "Authorization: Bot ${DISCORD_BOT_TOKEN}" \
  https://discord.com/api/v10/users/@me)
python3 -c 'import json; d=json.load(open("/tmp/discord-me.json")); print("http='"$code"'","user=",d.get("username"),"id=",d.get("id"),"bot=",d.get("bot"))'

echo "=== Telegram getMe ==="
curl -sS "${proxy_args[@]}" \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); r=d.get("result") or {}; print("ok=",d.get("ok"),"username=",r.get("username"),"id=",r.get("id"))'
