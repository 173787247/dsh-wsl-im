#!/usr/bin/env bash
set -euo pipefail
pid=$(pgrep -n -f 'node.*/dsh web' || true)
if [[ -n "${pid}" ]]; then
  # shellcheck disable=SC2046
  eval $(tr '\0' '\n' < "/proc/${pid}/environ" | grep -E '^(HTTPS_PROXY|https_proxy|HTTP_PROXY|http_proxy)=' | sed 's/^/export /' || true)
fi
tr -d '\r' < /mnt/c/Users/rchua/Desktop/AIFullStackDevelopment/dsh-wsl-im/scripts/probe-im-apis.sh > /tmp/probe-im-apis.sh
bash /tmp/probe-im-apis.sh
