/**
 * WeCom 智能机器人 long connection.
 * Protocol reference: OryxOS WeComWsClient / WeComMessageSender
 *   wss://openws.work.weixin.qq.com
 *   cmd: aibot_subscribe → aibot_msg_callback → aibot_send_msg
 */

import WebSocket from "ws";
import { randomUUID } from "node:crypto";

const WS_URL = "wss://openws.work.weixin.qq.com";

export function createWecomAdapter({ botId, secret, onMessage, logger }) {
  let ws;
  let heartbeat;
  let state = "down";
  let stopped = false;
  let reconnectTimer;

  const send = (frame) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("wecom: not connected");
    ws.send(JSON.stringify(frame));
  };

  const connect = () =>
    new Promise((resolve, reject) => {
      ws = new WebSocket(WS_URL);
      let subscribed = false;

      const fail = (err) => {
        cleanup();
        reject(err);
      };

      const onOpen = () => {
        send({
          cmd: "aibot_subscribe",
          headers: { req_id: randomUUID() },
          body: { bot_id: botId, secret },
        });
      };

      const onMessageFrame = async (raw) => {
        let frame;
        try {
          frame = JSON.parse(String(raw));
        } catch {
          return;
        }
        const cmd = frame.cmd || frame.body?.cmd;
        if (cmd === "aibot_subscribe" || frame.errcode !== undefined) {
          if (frame.errcode === 0 || frame.body?.errcode === 0 || subscribed) {
            if (!subscribed && (frame.cmd === "aibot_subscribe" || frame.errcode === 0)) {
              subscribed = true;
              state = "up";
              startHeartbeat();
              resolve();
            }
          } else if (frame.errcode && frame.errcode !== 0) {
            fail(new Error(`wecom subscribe failed: ${frame.errcode} ${frame.errmsg || ""}`));
            return;
          }
        }
        if (cmd === "pong") return;
        if (cmd === "aibot_msg_callback" || frame.body?.msgtype) {
          const body = frame.body || frame;
          const text = extractWecomText(body);
          if (!text) return;
          const chatId = body.chatid || body.chat_id || body.from?.userid || body.msgid || "wecom";
          const userId = body.from?.userid || body.userid || "unknown";
          const msgId = body.msgid || body.msg_id || randomUUID();
          await onMessage({
            platform: "wecom",
            chatId: String(chatId),
            userId: String(userId),
            text,
            messageId: String(msgId),
            reply: async (replyText) => {
              send({
                cmd: "aibot_send_msg",
                headers: { req_id: randomUUID() },
                body: {
                  chatid: String(chatId),
                  msgtype: "markdown",
                  markdown: { content: replyText },
                },
              });
            },
          });
        }
      };

      ws.once("open", onOpen);
      ws.on("message", (data) => {
        onMessageFrame(data).catch((e) => logger?.warn?.(`wecom handler: ${e.message}`));
      });
      ws.once("error", fail);
      ws.on("close", () => {
        state = "down";
        stopHeartbeat();
        if (!stopped) scheduleReconnect();
      });

      // Subscribe ACK timeout
      setTimeout(() => {
        if (!subscribed) fail(new Error("wecom: subscribe timeout"));
      }, 20_000);
    });

  function startHeartbeat() {
    stopHeartbeat();
    heartbeat = setInterval(() => {
      try {
        send({ cmd: "ping", headers: { req_id: randomUUID() } });
      } catch {
        /* ignore */
      }
    }, 30_000);
    heartbeat.unref?.();
  }
  function stopHeartbeat() {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
  }
  function cleanup() {
    stopHeartbeat();
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
  }
  function scheduleReconnect() {
    if (reconnectTimer || stopped) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect().catch((e) => logger?.warn?.(`wecom reconnect: ${e.message}`));
    }, 5_000);
  }

  return {
    name: "wecom",
    state: () => state,
    detail: () => WS_URL,
    async start() {
      stopped = false;
      await connect();
      logger?.info?.("dsh-wsl-im wecom aibot WS subscribed (OryxOS-aligned)");
    },
    stop() {
      stopped = true;
      state = "down";
      if (reconnectTimer) clearTimeout(reconnectTimer);
      cleanup();
    },
  };
}

export function extractWecomText(body) {
  if (!body) return undefined;
  if (body.msgtype === "text" && body.text?.content) return String(body.text.content).trim();
  if (body.msgtype === "markdown" && body.markdown?.content)
    return String(body.markdown.content).trim();
  if (typeof body.content === "string") return body.content.trim();
  return undefined;
}
