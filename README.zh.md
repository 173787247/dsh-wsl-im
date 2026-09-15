# dsh-wsl-im

让 **飞书 / 企微 / 钉钉 / QQ** 直接和 **dsh** 对话。

[English → README.md](./README.md)

> **运行时不经过 OryxOS。** 协议对齐 OryxOS 渠道适配器（见 [`docs/PROTOCOL.md`](./docs/PROTOCOL.md)）。链路：`IM → 本插件 → ctx.agents → 回 IM`。

## 首批测试

| 适配器 | 模式 | 凭证 |
|--------|------|------|
| 飞书 | 长连接 | `FEISHU_APP_ID` / `FEISHU_APP_SECRET` + `DSH_IM_FEISHU=1` |
| 企微 | 智能机器人 WSS | `WECOM_BOT_ID` / `WECOM_BOT_SECRET` + `DSH_IM_WECOM=1` |
| 钉钉 | Stream | `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` + `DSH_IM_DINGTALK=1` |
| QQ | 官方 Gateway | `QQ_APP_ID` / `QQ_APP_SECRET` + `DSH_IM_QQ=1` |
| mock | 本机 HTTP | `DSH_IM_MOCK=1` |

飞书还需在 profile 里安装 `@larksuiteoapi/node-sdk`。

## 安装

```sh
dsh plugin --profile web add github:173787247/dsh-wsl-im#v0.2.0
# 或跟踪默认分支
dsh plugin --profile web add github:173787247/dsh-wsl-im
```

**Awesome：** 条目草稿见 [`docs/awesome-entry.yml`](./docs/awesome-entry.yml)；仓库满 ≥1 天后再向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR（CI 会卡年龄）。

`source` 环境变量后 `restart-dsh-web.sh`，新开会话。可用工具 `im_status`。

## License

MIT
