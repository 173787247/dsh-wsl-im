# Provenance

This plugin is an **independent rewrite** of the Feishu, WeCom aibot, DingTalk Stream, and QQ Gateway wire protocols. It is licensed MIT, same as dsh.

Behavior comes from vendor protocol documents. This repository does not include, translate, or vendor another project's sources. Runtime dependencies are `ws` and `https-proxy-agent` (plus optional `@larksuiteoapi/node-sdk` for Feishu).

Do not copy or translate code from any other project. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## What must stay vendor-specific

Protocol constants and field names (`chat_id`, `open_id`, `msgtype`, `sessionWebhook`, `C2C_MESSAGE_CREATE`, `x-acs-dingtalk-access-token`, hostnames, event names) come from the platform documents. They are not an expression owned by any one client implementation.

The WeCom empty-ASR reply was rewritten so it is not the same sentence as any other client.

This note is an engineering record for review. It is not a legal opinion.
