# Changelog

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
