# Protocol notes

Wire behavior follows each vendor's documents.

| Platform | Mode | This plugin |
|----------|------|-------------|
| Feishu | WS long connection (`im.message.receive_v1`) | `lib/adapters/feishu.js` via `@larksuiteoapi/node-sdk` |
| WeCom | 智能机器人 WSS `openws.work.weixin.qq.com` | `lib/adapters/wecom.js` (`aibot_subscribe` / `aibot_msg_callback` / `aibot_send_msg`) |
| DingTalk | Stream gateway | `lib/adapters/dingtalk.js` + `sessionWebhook` reply |
| QQ | Official Bot Gateway | `lib/adapters/qq.js` (Identify intent `GROUP_AND_C2C_EVENT`) |

## Env names

| Adapter | Env |
|---------|-----|
| Feishu | `FEISHU_APP_ID` / `FEISHU_APP_SECRET` + `DSH_IM_FEISHU=1` |
| WeCom | `WECOM_BOT_ID` / `WECOM_BOT_SECRET` + `DSH_IM_WECOM=1` |
| DingTalk | `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` + `DSH_IM_DINGTALK=1` |
| QQ | `QQ_APP_ID` / `QQ_APP_SECRET` + `DSH_IM_QQ=1` |
| Mock | `DSH_IM_MOCK=1` |

## Inbound media

Same contract as WeCom: adapters pass `images` / `files` into `onMessage`. The bridge mounts `standard`, copies files into `inbox/`, and pre-extracts PDF text with `pdftotext`. No ffmpeg/Whisper on this host — video is stored only; voice is usable only when the platform supplies a transcript.

| Platform | Image | File / PDF | Voice | Video |
|----------|-------|------------|-------|-------|
| Feishu | `image_key` + GetMessageResource `type=image` | `file_key` `type=file` | `audio` + `file_key` (often silk; no platform ASR) | `media` + `file_key` |
| DingTalk | `picture` + `downloadCode` or `picURL` | `file` + `downloadCode` / `downloadUrl` | `audio` + `downloadCode` | `video` + `downloadCode` |
| QQ | `attachments[]` image mime or width/height | pdf / other → file | prefer `voice_wav_url`; text from `asr_refer_text` | `video/*`, `.mp4`, `.mov` |

Downloads stay on domestic hosts (Feishu OpenAPI, `*.dingtalk.com` / `*.aliyuncs.com` / `*.alicdn.com`, `*.qq.com` / `*.ugcimg.cn`). If `HTTPS_PROXY` is set, token / Stream / Gateway / media downloads use that agent — this WSL has no direct egress to those hosts.

## dsh side

```
IM adapter → Bridge.handleMessage → ctx.agents.create / followup → session/event → reply()
```

Same shape as community `dsh-im-hub`, kept inside this WSL-kit plugin so Feishu/WeCom/DingTalk/QQ stay one package.

Agent cwd is one directory per platform under `~/.dsh/im-workspace/{feishu,wecom,dingtalk,qq}` (override the parent with `DSH_IM_AGENT_CWD`). Plugin startup calls `ctx.workspaceRegistry.create` so those four folders appear in the desktop sidebar. Each chat is still its own session.

## WSL notes

All four adapters are **outbound** long connections — no public callback URL / inbound port map on Windows.

1. Credentials must be in the **WSL** process env (or sourced before `restart-dsh-web.sh`), not only Windows.
2. Windows VPN/proxy may not apply inside WSL; fix WSL egress if subscribe/connect fails.
3. QQ IP allowlists must use the **WSL egress IP** (often ≠ Windows host).
4. WeCom: one Bot = one live long connection (a new connect kicks the old).
