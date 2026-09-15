/**
 * QQ official bot Gateway adapter.
 * Protocol reference: OryxOS QqGatewayClient / QqAccessTokenClient
 *   POST https://bots.qq.com/app/getAppAccessToken
 *   GET  https://api.bot.qq.com/gateway → WSS Identify (intent GROUP_AND_C2C_EVENT)
 */

import WebSocket from "ws";

const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const API = "https://api.bot.qq.com";
const INTENTS = 1 << 25; // GROUP_AND_C2C_EVENT

export function createQqAdapter({ appId, appSecret, onMessage, logger }) {
  let ws;
  let state = "down";
  let stopped = false;
  let accessToken = "";
  let heartbeat;
  let sessionId;
  let seq = null;

  async function refreshToken() {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId, clientSecret: appSecret }),
    });
    const json = await res.json();
    accessToken = json.access_token;
    if (!accessToken) throw new Error(`qq token: ${JSON.stringify(json)}`);
    return accessToken;
  }

  async function gatewayUrl() {
    await refreshToken();
    const res = await fetch(`${API}/gateway`, {
      headers: { Authorization: `QQBot ${accessToken}` },
    });
    const json = await res.json();
    const url = json.url;
    if (!url) throw new Error(`qq gateway: ${JSON.stringify(json)}`);
    return url;
  }

  async function sendC2C(openid, content, msgId) {
    await refreshToken();
    await fetch(`${API}/v2/users/${openid}/messages`, {
      method: "POST",
      headers: {
        Authorization: `QQBot ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
        msg_type: 0,
        msg_id: msgId,
      }),
    });
  }

  async function sendGroup(groupOpenid, content, msgId) {
    await refreshToken();
    await fetch(`${API}/v2/groups/${groupOpenid}/messages`, {
      method: "POST",
      headers: {
        Authorization: `QQBot ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
        msg_type: 0,
        msg_id: msgId,
      }),
    });
  }

  const connect = async () => {
    const url = await gatewayUrl();
    await new Promise((resolve, reject) => {
      ws = new WebSocket(url);
      let helloOk = false;

      ws.on("message", (raw) => {
        let msg;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (typeof msg.s === "number") seq = msg.s;
        const op = msg.op;
        if (op === 10) {
          // Hello
          const interval = msg.d?.heartbeat_interval || 41250;
          ws.send(
            JSON.stringify({
              op: 2,
              d: {
                token: `QQBot ${accessToken}`,
                intents: INTENTS,
                shard: [0, 1],
              },
            }),
          );
          startHb(interval);
          helloOk = true;
        } else if (op === 0) {
          const t = msg.t;
          const d = msg.d || {};
          if (t === "READY") {
            sessionId = d.session_id;
            state = "up";
            resolve();
            return;
          }
          handleDispatch(t, d).catch((e) => logger?.warn?.(`qq dispatch: ${e.message}`));
        } else if (op === 11) {
          /* heartbeat ack */
        } else if (op === 7 || op === 9) {
          logger?.warn?.(`qq op=${op}, reconnecting`);
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }
      });
      ws.once("error", reject);
      ws.on("close", () => {
        state = "down";
        stopHb();
        if (!stopped) {
          setTimeout(() => connect().catch((e) => logger?.warn?.(`qq reconnect: ${e.message}`)), 5_000);
        }
      });
      setTimeout(() => {
        if (!helloOk && state !== "up") reject(new Error("qq: hello/ready timeout"));
      }, 25_000);
    });
  };

  async function handleDispatch(t, d) {
    // C2C / group at events (names may vary by bot openapi version)
    const text = d.content;
    if (typeof text !== "string" || !text.trim()) return;
    const cleaned = text.replace(/<@!\d+>/g, "").trim();
    if (!cleaned) return;
    const isGroup = Boolean(d.group_openid || d.group_id);
    const chatId = d.group_openid || d.author?.id || d.openid || "qq";
    const userId = d.author?.id || d.author?.member_openid || "unknown";
    const msgId = d.id;
    await onMessage({
      platform: "qq",
      chatId: String(chatId),
      userId: String(userId),
      text: cleaned,
      messageId: String(msgId || Date.now()),
      reply: async (replyText) => {
        if (isGroup) await sendGroup(d.group_openid, replyText, msgId);
        else await sendC2C(d.author?.id || d.openid, replyText, msgId);
      },
    });
  }

  function startHb(interval) {
    stopHb();
    heartbeat = setInterval(() => {
      try {
        ws?.send(JSON.stringify({ op: 1, d: seq }));
      } catch {
        /* ignore */
      }
    }, interval);
    heartbeat.unref?.();
  }
  function stopHb() {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
  }

  return {
    name: "qq",
    state: () => state,
    detail: () => (sessionId ? `session ${sessionId}` : API),
    async start() {
      stopped = false;
      await connect();
      logger?.info?.("dsh-wsl-im qq Gateway ready (OryxOS-aligned)");
    },
    stop() {
      stopped = true;
      state = "down";
      stopHb();
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
  };
}
