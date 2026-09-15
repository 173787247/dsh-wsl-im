/**
 * Feishu long-connection adapter.
 * Protocol aligned with OryxOS FeishuChannelAdapter (Lark WS + im.message.receive_v1).
 * Uses @larksuiteoapi/node-sdk when available; otherwise fails with install hint.
 */

const OPEN = "https://open.feishu.cn";

export function extractText(event) {
  const message = event?.event?.message ?? event?.message;
  if (!message || message.message_type !== "text") return undefined;
  try {
    const content =
      typeof message.content === "string" ? JSON.parse(message.content) : message.content;
    return typeof content?.text === "string" ? content.text : undefined;
  } catch {
    return undefined;
  }
}

export function createFeishuAdapter({ appId, appSecret, onMessage, logger }) {
  let wsClient;
  let apiClient;
  let state = "down";
  const seen = new Set();

  return {
    name: "feishu",
    state: () => state,
    async start() {
      let Lark;
      try {
        Lark = await import("@larksuiteoapi/node-sdk");
      } catch {
        throw new Error(
          "feishu: install peer dep `@larksuiteoapi/node-sdk` in the dsh profile (or link this plugin after npm i)",
        );
      }

      apiClient = new Lark.Client({
        appId,
        appSecret,
        appType: Lark.AppType.SelfBuild,
        domain: Lark.Domain.Feishu,
      });

      const dispatcher = new Lark.EventDispatcher({}).register({
        "im.message.receive_v1": async (data) => {
          const text = extractText({ event: data });
          if (!text) return;
          const message = data.message;
          const msgId = message?.message_id;
          if (msgId && seen.has(msgId)) return;
          if (msgId) {
            seen.add(msgId);
            if (seen.size > 2000) seen.clear();
          }
          // Strip @bot mention markers common in group chats
          const cleaned = text.replace(/@_user_\d+/g, "").trim();
          if (!cleaned) return;
          const chatId = message.chat_id;
          const userId = data.sender?.sender_id?.open_id || data.sender?.sender_id?.user_id || "unknown";
          await onMessage({
            platform: "feishu",
            chatId,
            userId,
            text: cleaned,
            messageId: msgId,
            reply: async (replyText) => {
              await apiClient.im.message.create({
                params: { receive_id_type: "chat_id" },
                data: {
                  receive_id: chatId,
                  msg_type: "text",
                  content: JSON.stringify({ text: replyText }),
                },
              });
            },
          });
        },
      });

      wsClient = new Lark.WSClient({
        appId,
        appSecret,
        domain: Lark.Domain.Feishu,
        loggerLevel: Lark.LoggerLevel.info,
      });
      await wsClient.start({ eventDispatcher: dispatcher });
      state = "up";
      logger?.info?.("dsh-wsl-im feishu WS connected (OryxOS-aligned long connection)");
    },
    stop() {
      state = "down";
      try {
        wsClient?.close?.();
      } catch {
        /* ignore */
      }
      wsClient = undefined;
    },
  };
}

export { OPEN };
