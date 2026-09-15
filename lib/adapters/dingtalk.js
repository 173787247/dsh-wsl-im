/**
 * DingTalk Stream adapter.
 * Protocol reference: OryxOS DingTalkStreamClient
 *   POST https://api.dingtalk.com/v1.0/gateway/connections/open
 *   topic /v1.0/im/bot/messages/get → sessionWebhook reply
 */

import WebSocket from "ws";

const API = "https://api.dingtalk.com";
const TOPIC_BOT = "/v1.0/im/bot/messages/get";

export function createDingtalkAdapter({ clientId, clientSecret, onMessage, logger }) {
  let ws;
  let state = "down";
  let stopped = false;

  async function openConnection() {
    const res = await fetch(`${API}/v1.0/gateway/connections/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        clientSecret,
        subscriptions: [
          { type: "CALLBACK", topic: TOPIC_BOT },
          { type: "SYSTEM", topic: "ping" },
          { type: "SYSTEM", topic: "disconnect" },
        ],
        ua: "dsh-wsl-im/0.2.0",
        localIp: "127.0.0.1",
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(`dingtalk open HTTP ${res.status}: ${JSON.stringify(json)}`);
    }
    const endpoint = json.endpoint || json.data?.endpoint;
    const ticket = json.ticket || json.data?.ticket;
    if (!endpoint || !ticket) throw new Error("dingtalk: missing endpoint/ticket");
    return `${endpoint}?ticket=${encodeURIComponent(ticket)}`;
  }

  const connect = async () => {
    const url = await openConnection();
    await new Promise((resolve, reject) => {
      ws = new WebSocket(url);
      ws.once("open", () => {
        state = "up";
        resolve();
      });
      ws.once("error", reject);
      ws.on("message", (raw) => {
        handleFrame(String(raw)).catch((e) => logger?.warn?.(`dingtalk: ${e.message}`));
      });
      ws.on("close", () => {
        state = "down";
        if (!stopped) {
          setTimeout(() => {
            connect().catch((e) => logger?.warn?.(`dingtalk reconnect: ${e.message}`));
          }, 5_000);
        }
      });
    });
  };

  async function handleFrame(raw) {
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    const type = frame.type;
    const topic = frame.headers?.topic || frame.topic;
    if (type === "SYSTEM" && topic === "ping") {
      ws.send(
        JSON.stringify({
          code: 200,
          headers: frame.headers,
          message: "OK",
          data: frame.data,
        }),
      );
      return;
    }
    if (type === "CALLBACK" && topic === TOPIC_BOT) {
      // ACK first (OryxOS: ACK_BOT_DATA)
      ws.send(
        JSON.stringify({
          code: 200,
          headers: frame.headers,
          message: "OK",
          data: JSON.stringify({ response: null }),
        }),
      );
      const data = typeof frame.data === "string" ? JSON.parse(frame.data) : frame.data;
      const text = extractDingText(data);
      if (!text) return;
      const chatId = data.conversationId || data.chatbotCorpId || data.senderId || "dingtalk";
      const userId = data.senderStaffId || data.senderId || "unknown";
      const sessionWebhook = data.sessionWebhook;
      await onMessage({
        platform: "dingtalk",
        chatId: String(chatId),
        userId: String(userId),
        text,
        messageId: String(data.msgId || data.messageId || Date.now()),
        reply: async (replyText) => {
          if (!sessionWebhook) throw new Error("dingtalk: no sessionWebhook");
          await fetch(sessionWebhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              msgtype: "text",
              text: { content: replyText },
            }),
          });
        },
      });
    }
  }

  return {
    name: "dingtalk",
    state: () => state,
    detail: () => TOPIC_BOT,
    async start() {
      stopped = false;
      await connect();
      logger?.info?.("dsh-wsl-im dingtalk Stream connected (OryxOS-aligned)");
    },
    stop() {
      stopped = true;
      state = "down";
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
  };
}

export function extractDingText(data) {
  if (!data) return undefined;
  const text = data.text?.content || data.content?.text || data.content;
  if (typeof text === "string") return text.trim();
  return undefined;
}
