# Provenance

This plugin is an **independent rewrite** of the Feishu, WeCom aibot, DingTalk Stream, and QQ Gateway wire protocols. It is licensed MIT, same as dsh.

OryxOS (`oryx-labs/oryxos`, Apache-2.0) was used only as a **protocol and behavior reference**. This repository does **not** include, translate, or vendor its Java sources. Runtime dependencies are `ws` and `https-proxy-agent` (plus optional `@larksuiteoapi/node-sdk` for Feishu). There is no OryxOS package.

Contributing to OryxOS does not change this license. Apache-2.0 has no copyleft. Obligations would attach only to code actually copied from that project. Do not copy it. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## What must stay vendor-specific

Protocol constants and field names (`chat_id`, `open_id`, `msgtype`, `sessionWebhook`, `C2C_MESSAGE_CREATE`, `x-acs-dingtalk-access-token`, hostnames, event names) come from the platform documents. They are not an expression owned by any one client implementation.

## Recorded comparison (2026-09-17)

Lexical compare of `lib/adapters/{feishu,wecom,dingtalk,qq}.js` against the corresponding `oryxos-channel-*` Java (comments, strings, and identifiers stripped; then line match):

| Adapter | Same code lines longer than 28 characters |
|---------|-------------------------------------------|
| feishu | 0 |
| wecom | 0 |
| dingtalk | 0 |
| qq | 0 |

The only overlapping human sentence found then was the WeCom empty-ASR reply. That string was rewritten in this change. Re-check after adapter edits; do not treat this table as a perpetual audit.

This note is an engineering record for review. It is not a legal opinion.
