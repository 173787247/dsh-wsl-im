#!/usr/bin/env bash
set -euo pipefail
ENV="${HOME}/.dsh/dsh-wsl-im.env"
SRC="/mnt/c/Users/rchua/Desktop/AIFullStackDevelopment/oryxos/.env"
ts=$(date +%Y%m%d%H%M%S)
cp -a "$ENV" "${ENV}.bak.${ts}"

tmp=$(mktemp)
grep -vE '^(DSH_IM_SLACK|SLACK_BOT_TOKEN|SLACK_APP_TOKEN|SLACK_TEAM_ID|DSH_IM_DISCORD|DISCORD_BOT_TOKEN|DISCORD_APPLICATION_ID|DSH_IM_TELEGRAM|TELEGRAM_BOT_TOKEN|TELEGRAM_BOT_USERNAME)=' "$ENV" | tr -d '\r' > "$tmp" || true

get() {
  grep -E "^[[:space:]]*$1=" "$SRC" | tr -d '\r' | head -1 | cut -d= -f2-
}

SB=$(get SLACK_BOT_TOKEN)
SA=$(get SLACK_APP_TOKEN)
ST=$(get SLACK_TEAM_ID)
DB=$(get DISCORD_BOT_TOKEN)
DA=$(get DISCORD_APPLICATION_ID)
TB=$(get TELEGRAM_BOT_TOKEN)
TU=$(get TELEGRAM_BOT_USERNAME)

{
  cat "$tmp"
  echo ""
  echo "# --- from oryxos/.env (Slack / Discord / Telegram) ---"
  echo "DSH_IM_SLACK=1"
  echo "SLACK_BOT_TOKEN=${SB}"
  echo "SLACK_APP_TOKEN=${SA}"
  if [[ -n "${ST}" ]]; then echo "SLACK_TEAM_ID=${ST}"; fi
  echo "DSH_IM_DISCORD=1"
  echo "DISCORD_BOT_TOKEN=${DB}"
  echo "DISCORD_APPLICATION_ID=${DA}"
  echo "DSH_IM_TELEGRAM=1"
  echo "TELEGRAM_BOT_TOKEN=${TB}"
  echo "TELEGRAM_BOT_USERNAME=${TU}"
} > "$ENV"
chmod 600 "$ENV"
rm -f "$tmp"

echo "OK wrote ${ENV}"
echo "flags:"
grep -E '^(DSH_IM_SLACK|DSH_IM_DISCORD|DSH_IM_TELEGRAM|SLACK_|DISCORD_|TELEGRAM_)=' "$ENV" | sed -E 's/=.+/=<set>/'
echo "lengths: slack_bot=${#SB} slack_app=${#SA} discord=${#DB} discord_app=${#DA} tg=${#TB} tg_user=${#TU}"
