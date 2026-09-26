#!/usr/bin/env bash
set -euo pipefail
echo "=== process env flags ==="
pid=$(pgrep -n -f 'node.*/dsh web' || true)
if [[ -n "${pid}" ]]; then
  tr '\0' '\n' < "/proc/${pid}/environ" | grep -E '^(DSH_IM_|SLACK_|DISCORD_|TELEGRAM_)' | sed -E 's/=.*/=<set>/' || true
else
  echo "no dsh web pid"
fi
echo "=== recent im-related log ==="
grep -Ei 'dsh-wsl-im|slack|discord|telegram|Socket Mode|Gateway|long-poll|im_status|adapter' /tmp/dsh-web.log | tail -80 || true
echo "=== log tail ==="
tail -30 /tmp/dsh-web.log
