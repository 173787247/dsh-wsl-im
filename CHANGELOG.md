# Changelog

## 0.2.1

- IM sessions mount `agentPresets` (default `standard`) so bash/read/fs are available.
- WeCom file names get magic-based extensions (e.g. `.pdf`); PDF text pre-extracted via `pdftotext` into the user message.
- Agent cwd defaults to `~/.dsh/im-workspace`; attachments also copied to `inbox/`.

## 0.2.0

- **Breaking:** remove OryxOS HTTP tools (`oryx_*`). IM now bridges **directly to dsh agents**.
- Adapters: Feishu WS, WeCom aibot WS, DingTalk Stream, QQ Gateway, mock HTTP.
- WeCom WS uses `HTTPS_PROXY`/`HTTP_PROXY` via `https-proxy-agent` (direct often times out).
- Protocols documented against OryxOS channel modules (`docs/PROTOCOL.md`).
- Tool: `im_status`.

## 0.1.0

- Initial mistaken design (OryxOS HTTP proxy). Superseded by 0.2.0.
