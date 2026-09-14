# dsh-wsl-im

DeepSeek Harness 工具：把 **dsh** 接到本机 **OryxOS** 已对接的 IM 栈。

[English → README.md](./README.md)

> **尚未打进 dsh-wsl-kit。** 请直接装本仓。IM 只走 OryxOS，本插件**不**内嵌飞书 / 企微 / Telegram 等 SDK。

---

## 兼容性

| 字段 | 值 |
|------|-----|
| **插件** | `dsh-wsl-im` **0.1.0** |
| **最低 dsh** | ≥ **0.1.2**（Windows relay `:3081` 一次性 `?token=`） |
| **最新验证** | 见 [dsh-wsl-kit Compatibility](https://github.com/173787247/dsh-wsl-kit#compatibility-2026-09) |
| **Kit 套件** | 尚未入库 |
| **Cloud Flash** | 模型 id **`deepseek-flash`** — 本插件不配 |
| **Agent Teams** | 上游实验；非必需 |
| **OryxOS** | 本机 HTTP `ORYXOS_BASE_URL`（默认 `http://127.0.0.1:8080`） |

## 架构

```
IM（飞书 / Telegram / …）
        ↕  OryxOS 渠道适配器（.oryxos/channels.yaml）
OryxOS HTTP  /api/v1/channels|status|notify-channels|agents/.../invoke
        ↕  dsh-wsl-im 工具
       dsh
```

**IM → OryxOS Agent**：已在 OryxOS 内完成（`channels.yaml` 的 `agent:`）。  
**dsh → OryxOS**：本插件查渠道状态，并用 `oryx_invoke` 调同一批 Agent。  
**主动往 IM 推送**：仍由 OryxOS 内 Agent 的 notify 工具完成；本插件用 `oryx_notify_list` 列资源。

### OryxOS 已实现入站类型

`feishu` · `wecom` · `dingtalk` · `slack` · `discord` · `telegram` · `whatsapp` · `teams` · `gchat` · `mattermost` · `matrix` · `qq` · `douyin` · `weixin` · `weixin_kf` · `weixin_mp` · `weixin_mini` · `alipay`

（仅有 specs、未建模块：淘宝、拼多多。）

## 工具

| 工具 | OryxOS API | 用途 |
|------|------------|------|
| `oryx_health` | `GET /api/v1/health` | 探活 |
| `oryx_im_list` | `GET /api/v1/channels` | 渠道定义 |
| `oryx_im_status` | `GET /api/v1/channels/status` | 实时状态 |
| `oryx_notify_list` | `GET /api/v1/notify-channels` | 出站 Notify 资源 |
| `oryx_invoke` | `POST /api/v1/agents/{name}/invoke` | 无状态调用 Agent |

## 安装

```sh
dsh plugin --profile web add github:173787247/dsh-wsl-im
```

然后 `restart-dsh-web.sh`，并**新开会话**。

## 配置

见 `examples/dsh-wsl-im.env.example`：`ORYXOS_BASE_URL` / `ORYXOS_API_KEY` / `ORYXOS_DEFAULT_AGENT`。密钥勿进对话。

## 测试

```sh
npm test
```

## License

MIT
