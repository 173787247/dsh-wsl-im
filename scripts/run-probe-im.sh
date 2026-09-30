#!/usr/bin/env bash
set -euo pipefail
pid=$(pgrep -n -f 'node.*/dsh web' || true)
if [[ -n "${pid}" ]]; then
  # shellcheck disable=SC2046
  eval $(tr '\0' '\n' < "/proc/${pid}/environ" | grep -E '^(HTTPS_PROXY|https_proxy|HTTP_PROXY|http_proxy)=' | sed 's/^/export /' || true)
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tr -d '\r' < "${SCRIPT_DIR}/probe-im-apis.sh" > /tmp/probe-im-apis.sh
bash /tmp/probe-im-apis.sh
