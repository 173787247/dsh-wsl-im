# dsh-wsl-im

DeepSeek Harness plugin: chat with **dsh** from **Feishu / WeCom / DingTalk / QQ**.

[中文说明 → README.zh.md](./README.zh.md)

> **Runtime does not use OryxOS.** Platform protocols are **referenced from** [OryxOS](https://github.com/) channel adapters (see [`docs/PROTOCOL.md`](./docs/PROTOCOL.md)). Messages go: `IM → this plugin → ctx.agents → reply`.

---

## Compatibility

| Field | Value |
|-------|-------|
| **Plugin** | `dsh-wsl-im` **0.2.0** |
| **Minimum dsh** | ≥ **0.1.2** |
| **Latest verified** | See [dsh-wsl-kit Compatibility](https://github.com/173787247/dsh-wsl-kit#compatibility-2026-09) |
| **Kit set** | not in kit yet |
| **Cloud Flash** | `deepseek-flash` — not configured here |

## Architecture

```
Feishu WS / WeCom aibot WS / DingTalk Stream / QQ Gateway
        ↕  adapters (OryxOS protocol reference)
   dsh-wsl-im Bridge
        ↕  ctx.agents.create + followup
       dsh agent session → reply text back to IM
```

## Adapters (v0.2 test set)

| Adapter | Mode | Creds |
|---------|------|-------|
| `feishu` | Long connection | `FEISHU_APP_ID` / `FEISHU_APP_SECRET` |
| `wecom` | 智能机器人 WSS | `WECOM_BOT_ID` / `WECOM_BOT_SECRET` |
| `dingtalk` | Stream | `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` |
| `qq` | Official Gateway | `QQ_APP_ID` / `QQ_APP_SECRET` |
| `mock` | Local HTTP | `DSH_IM_MOCK=1` → `POST http://127.0.0.1:18999/mock` |

Enable with `DSH_IM_FEISHU=1` (etc.) or `adapters.*.enabled: true` in patch config.

### Feishu peer dependency

```sh
# inside the dsh profile / plugin install tree
npm i @larksuiteoapi/node-sdk
```

## Install

```sh
dsh plugin --profile web add github:173787247/dsh-wsl-im
# or local:
# dsh plugin --profile web add /mnt/c/Users/.../dsh-wsl-im
```

Source env (see `examples/dsh-wsl-im.env.example`), restart web, **new session**. Tool: `im_status`.

### Mock smoke (no real bot)

```sh
export DSH_IM_MOCK=1
# restart dsh web, then:
curl -s http://127.0.0.1:18999/mock -H 'content-type: application/json' \
  -d '{"text":"/status","chatId":"t1"}'
```

## Security

Empty `allowedUserIds` = everyone. Set a whitelist before exposing bots. IM input can drive tools on the host.

## License

MIT
