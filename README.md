# dsh-wsl-im

DeepSeek Harness tools that bridge **dsh ↔ local [OryxOS](https://github.com/)** IM stack.

[中文说明 → README.zh.md](./README.zh.md)

> **Not in dsh-wsl-kit yet.** Install this repo directly. Prefer OryxOS as the only IM gateway — this plugin never embeds Feishu / WeCom / Telegram SDKs.

---

## Compatibility

| Field | Value |
|-------|-------|
| **Plugin** | `dsh-wsl-im` **0.1.0** |
| **Minimum dsh** | ≥ **0.1.2** (web UI one-shot `?token=` on Windows relay `:3081`) |
| **Latest verified** | See [dsh-wsl-kit Compatibility](https://github.com/173787247/dsh-wsl-kit#compatibility-2026-09) |
| **Kit set** | not in kit yet |
| **Cloud Flash** | Use model id **`deepseek-flash`** — not configured by this plugin |
| **Agent Teams** | Upstream experimental; not required here |
| **OryxOS** | Local HTTP `ORYXOS_BASE_URL` (default `http://127.0.0.1:8080`) |

## Architecture

```
IM (feishu / telegram / …)
        ↕  OryxOS channel adapters (.oryxos/channels.yaml)
OryxOS HTTP  /api/v1/channels|status|notify-channels|agents/.../invoke
        ↕  dsh-wsl-im tools
       dsh
```

**Inbound IM → OryxOS agent** already works inside OryxOS (bind `agent:` in `channels.yaml`).  
**dsh → OryxOS** uses this plugin to inspect channels and `oryx_invoke` the same agents.  
**Proactive push to IM** stays inside OryxOS (agent `notify_*` tools / notify-channel defs) — list them with `oryx_notify_list`.

### Platforms OryxOS already wires (inbound)

`feishu` · `wecom` · `dingtalk` · `slack` · `discord` · `telegram` · `whatsapp` · `teams` · `gchat` · `mattermost` · `matrix` · `qq` · `douyin` · `weixin` · `weixin_kf` · `weixin_mp` · `weixin_mini` · `alipay`

(Specs-only / not built: taobao, pdd.)

## Tools

| Tool | OryxOS API | Purpose |
|------|------------|---------|
| `oryx_health` | `GET /api/v1/health` | Reachability |
| `oryx_im_list` | `GET /api/v1/channels` | Channel defs (name/type/agent) |
| `oryx_im_status` | `GET /api/v1/channels/status` | Live CONNECTED / … |
| `oryx_notify_list` | `GET /api/v1/notify-channels` | Outbound notify resources |
| `oryx_invoke` | `POST /api/v1/agents/{name}/invoke` | Stateless talk to an agent |

## Install

```sh
dsh plugin --profile web add github:173787247/dsh-wsl-im
# or local:
# dsh plugin --profile web add /mnt/c/Users/.../dsh-wsl-im
```

Then restart web (`dsh-wsl-kit/scripts/restart-dsh-web.sh`) and open a **new** session.

## Config

`cordis.patch.yml` / env (see `examples/dsh-wsl-im.env.example`):

| Key | Env | Default |
|-----|-----|---------|
| `baseUrl` | `ORYXOS_BASE_URL` | `http://127.0.0.1:8080` |
| `apiKey` | `ORYXOS_API_KEY` | empty |
| `defaultAgent` | `ORYXOS_DEFAULT_AGENT` | empty |
| `timeoutMs` | `ORYXOS_TIMEOUT_MS` | `60000` |

Optional: `source ~/.dsh/dsh-wsl-im.env` before restart. **Never** paste keys into chat or tool output.

## Test

```sh
npm test
```

## License

MIT
