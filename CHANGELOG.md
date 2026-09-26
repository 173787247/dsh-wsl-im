# Changelog

## 0.3.8

- Allowlists from env: `DSH_IM_<PLATFORM>_ALLOWED_USER_IDS` (comma/space-separated),
  e.g. `DSH_IM_QQ_ALLOWED_USER_IDS=…`. Cordis `allowedUserIds` still wins when non-empty.

## 0.3.7

- Add **Mattermost** adapter: Outgoing Webhook listener + Bot REST `POST /api/v4/posts`
  (`DSH_IM_MATTERMOST=1`, `MATTERMOST_URL`, `MATTERMOST_TOKEN`, optional webhook path/port/token).
- Workspace `~/.dsh/im-workspace/mattermost`; plain-text outbound like QQ/Telegram.
- Optional `agent.vecmemOnReply` / `DSH_IM_VECMEM_ON_REPLY=1`: after a successful reply, best-effort
  `vecmem_add` with `workspace=im:{platform}` (first 500 chars). Documented in PROTOCOL.

## 0.3.6

- Security: startup warning when `allowedUserIds` is empty; `im_status.allowlistOpen`.
  Set `requireAllowlist` / `DSH_IM_REQUIRE_ALLOWLIST=1` to refuse starting open adapters.
- Voice: optional local Whisper ASR (`lib/local-asr.js`, `voiceAsr`) when platform ASR is empty.

## 0.3.5

- QQ / DingTalk / Telegram outbound: flatten Markdown tables, headings, and emphasis
  into plain text (`lib/im-plain.js`) so IM clients without GFM stay readable.

## 0.3.4

- Unify outbound HTTP with WebSocket: DingTalk / Slack / QQ / Discord / Telegram API
  calls use `proxiedFetch` (honors `HTTPS_PROXY` / `HTTP_PROXY` via `https-proxy-agent`).

## 0.3.3

- Fix session format v4: user message `source.kind` is now `plugin:dsh-wsl-im` (retired bare `plugin`).

## Unreleased

- WeCom asks for a text message when a voice clip has no transcript.

## 0.3.2

- Add **Telegram** long-poll adapter (`DSH_IM_TELEGRAM=1` + `TELEGRAM_BOT_TOKEN`; optional `TELEGRAM_BOT_USERNAME` for group @).
- Workspace `~/.dsh/im-workspace/telegram`.

## 0.3.1

- Add **Discord Gateway** adapter (`DSH_IM_DISCORD=1` + `DISCORD_BOT_TOKEN`; optional `DISCORD_APPLICATION_ID`).
- Guild messages require bot mention; DMs accepted. Workspace `~/.dsh/im-workspace/discord`.

## 0.3.0

- Add **Slack Socket Mode** adapter (`DSH_IM_SLACK=1` + `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN`).
- Per-IM workspace `~/.dsh/im-workspace/slack` (sidebar title Slack).
- Inbound: DM `message` + channel `app_mention`; optional file/image via `url_private` + bot token.
- Reply via `chat.postMessage` (thread_ts for mentions). Protocol notes in `docs/PROTOCOL.md`.

## 0.2.4

- Each IM gets its own dsh workspace: `~/.dsh/im-workspace/{feishu,wecom,dingtalk,qq}`. Startup registers them with titles 飞书 / 企微 / 钉钉 / QQ so the sidebar lists them without a manual add. Chats stay one session each. `DSH_IM_AGENT_CWD` is the parent directory.

## 0.2.3

- DingTalk inbound media accepts `http` OSS temp URLs (`*.aliyuncs.com`) and downloads them through `HTTPS_PROXY` when set.

## 0.2.2

- Feishu, DingTalk, and QQ inbound now match WeCom: image, file/PDF, voice, and video.
- Voice uses platform ASR when present (`asr_refer_text` on QQ); otherwise the audio is saved and the user is asked for text (no Whisper).
- Video is saved to the workspace but not frame-transcribed.
- Group messages without @ are ignored on Feishu and DingTalk.

## 0.2.1

- IM sessions mount `agentPresets` (default `standard`) so bash/read/fs are available.
- WeCom file names get magic-based extensions (e.g. `.pdf`); PDF text pre-extracted via `pdftotext` into the user message.
- Agent cwd defaults to `~/.dsh/im-workspace`; attachments also copied to `inbox/`.

## 0.2.0

- **Breaking:** drop the earlier HTTP-proxy tools. IM now bridges **directly to dsh agents**.
- Adapters: Feishu WS, WeCom aibot WS, DingTalk Stream, QQ Gateway, mock HTTP.
- WeCom WS uses `HTTPS_PROXY`/`HTTP_PROXY` via `https-proxy-agent` (direct often times out).
- Protocols documented in `docs/PROTOCOL.md`.
- Tool: `im_status`.

## 0.1.0

- Initial HTTP-proxy design. Superseded by 0.2.0.
