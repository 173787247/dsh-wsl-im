# Protocol notes (OryxOS as reference)

This plugin **does not call OryxOS**. It re-implements the same platform protocols so IM chats drive **dsh agents** directly.

| Platform | Mode | OryxOS reference (Java) | This plugin |
|----------|------|-------------------------|-------------|
| Feishu | WS long connection (`im.message.receive_v1`) | `oryxos-channel-feishu` / `FeishuChannelAdapter` | `lib/adapters/feishu.js` via `@larksuiteoapi/node-sdk` |
| WeCom | 智能机器人 WSS `openws.work.weixin.qq.com` | `oryxos-channel-wecom` / `WeComWsClient` | `lib/adapters/wecom.js` (`aibot_subscribe` / `aibot_msg_callback` / `aibot_send_msg`) |
| DingTalk | Stream gateway | `oryxos-channel-dingtalk` / `DingTalkStreamClient` | `lib/adapters/dingtalk.js` + `sessionWebhook` reply |
| QQ | Official Bot Gateway | `oryxos-channel-qq` / `QqGatewayClient` | `lib/adapters/qq.js` (Identify intent `GROUP_AND_C2C_EVENT`) |

## Env mapping (aligned with OryxOS `.env` names where possible)

| Adapter | Env |
|---------|-----|
| Feishu | `FEISHU_APP_ID` / `FEISHU_APP_SECRET` + `DSH_IM_FEISHU=1` |
| WeCom | `WECOM_BOT_ID` / `WECOM_BOT_SECRET` + `DSH_IM_WECOM=1` |
| DingTalk | `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` + `DSH_IM_DINGTALK=1` |
| QQ | `QQ_APP_ID` / `QQ_APP_SECRET` + `DSH_IM_QQ=1` |
| Mock | `DSH_IM_MOCK=1` |

## dsh side

```
IM adapter → Bridge.handleMessage → ctx.agents.create / followup → session/event → reply()
```

Same shape as community `dsh-im-hub`, kept inside this WSL-kit plugin so Feishu/WeCom/DingTalk/QQ stay one package.
