# Protocol notes

Wire behavior follows each vendor's documents.

| Platform | Mode | This plugin |
|----------|------|-------------|
| Feishu | WS long connection (`im.message.receive_v1`) | `lib/adapters/feishu.js` via `@larksuiteoapi/node-sdk` |
| WeCom | 智能机器人 WSS `openws.work.weixin.qq.com` | `lib/adapters/wecom.js` (`aibot_subscribe` / `aibot_msg_callback` / `aibot_send_msg`) |
| DingTalk | Stream gateway | `lib/adapters/dingtalk.js` + `sessionWebhook` reply |
| QQ | Official Bot Gateway | `lib/adapters/qq.js` (Identify intent `GROUP_AND_C2C_EVENT`) |
| Slack | Socket Mode WSS | `lib/adapters/slack.js` (`apps.connections.open` → Events API envelopes → `chat.postMessage`) |
| Discord | Gateway WSS v10 | `lib/adapters/discord.js` (Identify/Heartbeat → `MESSAGE_CREATE` → REST `channels/{id}/messages`) |
| Telegram | Bot API long-poll | `lib/adapters/telegram.js` (`getUpdates` → `sendMessage`; no webhook) |

## Env names

| Adapter | Env |
|---------|-----|
| Feishu | `FEISHU_APP_ID` / `FEISHU_APP_SECRET` + `DSH_IM_FEISHU=1` |
| WeCom | `WECOM_BOT_ID` / `WECOM_BOT_SECRET` + `DSH_IM_WECOM=1` |
| DingTalk | `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` + `DSH_IM_DINGTALK=1` |
| QQ | `QQ_APP_ID` / `QQ_APP_SECRET` + `DSH_IM_QQ=1` |
| Slack | `SLACK_BOT_TOKEN` (`xoxb-`) / `SLACK_APP_TOKEN` (`xapp-`) + `DSH_IM_SLACK=1` |
| Discord | `DISCORD_BOT_TOKEN` + `DSH_IM_DISCORD=1` (+ optional `DISCORD_APPLICATION_ID`) |
| Telegram | `TELEGRAM_BOT_TOKEN` + `DSH_IM_TELEGRAM=1` (+ optional `TELEGRAM_BOT_USERNAME`) |
| Mock | `DSH_IM_MOCK=1` |

## Inbound media

Same contract as WeCom: adapters pass `images` / `files` into `onMessage`. The bridge mounts `standard`, copies files into `inbox/`, and pre-extracts PDF text with `pdftotext`. No ffmpeg/Whisper on this host — video is stored only; voice is usable only when the platform supplies a transcript.

| Platform | Image | File / PDF | Voice | Video |
|----------|-------|------------|-------|-------|
| Feishu | `image_key` + GetMessageResource `type=image` | `file_key` `type=file` | `audio` + `file_key` (often silk; no platform ASR) | `media` + `file_key` |
| DingTalk | `picture` + `downloadCode` or `picURL` | `file` + `downloadCode` / `downloadUrl` | `audio` + `downloadCode` | `video` + `downloadCode` |
| QQ | `attachments[]` image mime or width/height | pdf / other → file | prefer `voice_wav_url`; text from `asr_refer_text` | `video/*`, `.mp4`, `.mov` |
| Slack | `files[].url_private` (+ bot token) | same | save + ask text (no ASR) | save only |
| Discord | `attachments[].url` (CDN allowlist) | same | save + ask text | save only |
| Telegram | `photo` / `document` via `getFile` | same | `voice` / `audio` → save + ask text | `video` / `video_note` save only |

Downloads stay on domestic hosts (Feishu OpenAPI, `*.dingtalk.com` / `*.aliyuncs.com` / `*.alicdn.com`, `*.qq.com` / `*.ugcimg.cn`), Slack (`*.slack.com`), Discord CDN, or Telegram (`api.telegram.org`) with bot auth. If `HTTPS_PROXY` is set, token / Stream / Gateway / Socket Mode / long-poll / media downloads use that agent — this WSL has no direct egress to those hosts.

## dsh side

```
IM adapter → Bridge.handleMessage → ctx.agents.create / followup → session/event → reply()
```

Same shape as community `dsh-im-hub`, kept inside this WSL-kit plugin so Feishu/WeCom/DingTalk/QQ/Slack/Discord/Telegram stay one package.

## Slack smoke (optional)

1. Slack app: enable **Socket Mode**, subscribe to `message.im` and `app_mention`, install bot scopes `chat:write`, `im:history`, `files:read`.
2. Put in `~/.dsh/dsh-wsl-im.env`:
   ```
   DSH_IM_SLACK=1
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_APP_TOKEN=xapp-...
   ```
3. `bash …/dsh-wsl-kit/scripts/restart-dsh-web.sh`, then `im_status` and DM the bot.

## Discord smoke (optional)

1. Bot with Message Content Intent; invite with send-message permissions.
2. Env: `DSH_IM_DISCORD=1`, `DISCORD_BOT_TOKEN=…`, optional `DISCORD_APPLICATION_ID=…`.
3. Restart web; DM the bot or @ it in a guild channel.

## Telegram smoke (optional)

1. Create a bot via BotFather; note token and username.
2. Env: `DSH_IM_TELEGRAM=1`, `TELEGRAM_BOT_TOKEN=…`, `TELEGRAM_BOT_USERNAME=YourBot`.
3. Restart web; private chat works; groups need @bot.

Agent cwd is one directory per platform under `~/.dsh/im-workspace/{feishu,wecom,dingtalk,qq,slack,discord,telegram}` (override the parent with `DSH_IM_AGENT_CWD`). Plugin startup calls `ctx.workspaceRegistry.create` so those folders appear in the desktop sidebar. Each chat is still its own session.

## WSL notes

All adapters are **outbound** long connections or long-poll — no public callback URL / inbound port map on Windows.

1. Credentials must be in the **WSL** process env (or sourced before `restart-dsh-web.sh`), not only Windows.
2. Windows VPN/proxy may not apply inside WSL; fix WSL egress if subscribe/connect fails.
3. QQ IP allowlists must use the **WSL egress IP** (often ≠ Windows host).
4. WeCom: one Bot = one live long connection (a new connect kicks the old).
