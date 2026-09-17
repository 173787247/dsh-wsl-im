# dsh-wsl-im

DeepSeek Harness plugin: chat with **dsh** from **Feishu / WeCom / DingTalk / QQ**.

[中文说明 → README.zh.md](./README.zh.md)

> **Independent rewrite.** Vendor docs define the wire protocol. OryxOS was a behavior reference only; its code is not included. See [`docs/PROVENANCE.md`](./docs/PROVENANCE.md). Messages go: `IM → this plugin → ctx.agents → reply`.

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
        ↕  adapters (vendor protocol docs)
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

### WeCom proxy

`openws.work.weixin.qq.com` often needs `HTTPS_PROXY`/`HTTP_PROXY`. The adapter uses `https-proxy-agent` (`ws` ignores `NODE_USE_ENV_PROXY`). One Bot = one live WS — disable the same Bot on OryxOS/OpenClaw while testing.

## Install

```sh
# latest tagged release
dsh plugin --profile web add github:173787247/dsh-wsl-im#v0.2.0
# or track default branch
dsh plugin --profile web add github:173787247/dsh-wsl-im
```

**Awesome:** entry draft in [`docs/awesome-entry.yml`](./docs/awesome-entry.yml) — submit to [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) after the repo is ≥1 day old (CI gate).

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
