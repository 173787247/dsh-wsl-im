/**
 * QQ official bot Gateway adapter.
 * Independent rewrite of the QQ official Gateway wire protocol.
 * OryxOS was a behavior reference only; this file does not include its code.
 * See docs/PROVENANCE.md.
 *   POST https://bots.qq.com/app/getAppAccessToken
 *   GET  https://api.bot.qq.com/gateway → WSS Identify (intent GROUP_AND_C2C_EVENT)
 */

import WebSocket from "ws";
import { resolveWsProxyAgent } from "../proxy.js";
import { downloadBytes } from "../download.js";
import {
  QQ_MEDIA_HOSTS,
  asrText,
  hostAllowed,
  mediaUserText,
  toBridgePart,
} from "../inbound-media.js";

const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const API = "https://api.bot.qq.com";
const INTENTS = 1 << 25; // GROUP_AND_C2C_EVENT
const EVENT_C2C = "C2C_MESSAGE_CREATE";
const EVENT_GROUP_AT = "GROUP_AT_MESSAGE_CREATE";

function stripMentions(text) {
  return String(text || "")
    .replace(/<@!?\w+>/g, "")
    .trim();
}

/**
 * Parse QQ Gateway dispatch into text + attachment refs (no download).
 * Voice prefers voice_wav_url; optional asr_refer_text becomes [语音转写].
 */
export function parseQqDispatch(eventName, data) {
  if (eventName !== EVENT_C2C && eventName !== EVENT_GROUP_AT) return { skip: "event" };
  const d = data || {};
  const items = [];
  const asrParts = [];
  const attachments = Array.isArray(d.attachments) ? d.attachments : [];
  for (const file of attachments) {
    if (!file || typeof file !== "object") continue;
    const mime = String(file.content_type || "").toLowerCase();
    const voice = mime === "voice" || mime.startsWith("audio/");
    let url = file.url;
    let name = file.filename;
    if (voice && file.voice_wav_url) {
      url = file.voice_wav_url;
      if (!name || !String(name).toLowerCase().endsWith(".wav")) name = "voice.wav";
    }
    if (!url) continue;
    const refer = String(file.asr_refer_text || "").trim();
    if (refer) asrParts.push(refer);
    const lowerName = String(name || "").toLowerCase();
    let kind = "file";
    if (mime.startsWith("image/") || (Number(file.width) > 0 && Number(file.height) > 0)) kind = "image";
    else if (voice) kind = "audio";
    else if (mime.startsWith("video/") || lowerName.endsWith(".mp4") || lowerName.endsWith(".mov"))
      kind = "video";
    items.push({ kind, url, name: name || (kind === "image" ? "qq-image" : "qq-file") });
  }
  const text = stripMentions(d.content);
  const asr = asrParts.join(" ").trim();
  return { text, asr, items, isGroup: eventName === EVENT_GROUP_AT };
}

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
      ws = new WebSocket(url, { agent: resolveWsProxyAgent() });
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
    const parsed = parseQqDispatch(t, d);
    if (parsed.skip) return;
    const isGroup = parsed.isGroup || Boolean(d.group_openid);
    const chatId = d.group_openid || d.author?.user_openid || d.author?.id || d.openid || "qq";
    const userId = d.author?.user_openid || d.author?.member_openid || d.author?.id || "unknown";
    const msgId = d.id;
    const reply = async (replyText) => {
      if (isGroup) await sendGroup(d.group_openid, replyText, msgId);
      else await sendC2C(d.author?.user_openid || d.author?.id || d.openid, replyText, msgId);
    };
    let text = parsed.text || "";
    const images = [];
    const files = [];
    if (parsed.items?.length) {
      try {
        await refreshToken();
        for (const item of parsed.items) {
          const bytes = await downloadBytes(item.url, {
            headers: { Authorization: `QQBot ${accessToken}` },
            allow: (u) => hostAllowed(u, QQ_MEDIA_HOSTS),
          });
          const part = toBridgePart({
            kind: item.kind,
            name: item.name,
            data: bytes,
            fallbackName: item.name,
          });
          if (part.image) images.push(part.image);
          if (part.file) files.push(part.file);
          console.info(
            `[dsh-wsl-im/qq] ${item.kind} resolved name=${part.name} bytes=${bytes.length}`,
          );
        }
      } catch (e) {
        console.warn(`[dsh-wsl-im/qq] media resolve failed: ${e?.message || e}`);
        if (parsed.asr && images.length === 0 && files.length === 0) {
          text = asrText(parsed.asr);
        } else {
          await reply(`⚠️ 附件下载失败: ${e instanceof Error ? e.message : String(e)}`).catch(() => {});
          return;
        }
      }
    }
    if (!text && parsed.asr) text = asrText(parsed.asr);
    else if (!text && files.length) {
      const voice = parsed.items?.find((i) => i.kind === "audio");
      const video = parsed.items?.find((i) => i.kind === "video");
      const named = files[0]?.name || "附件";
      if (voice) text = mediaUserText({ kind: "audio", name: named });
      else if (video) text = mediaUserText({ kind: "video", name: named });
      else text = mediaUserText({ kind: "file", name: named });
    } else if (!text && images.length) {
      text = mediaUserText({ kind: "image", name: "图片" });
    }
    if (!text && images.length === 0 && files.length === 0) return;
    await onMessage({
      platform: "qq",
      chatId: String(chatId),
      userId: String(userId),
      text,
      images,
      files,
      messageId: String(msgId || Date.now()),
      reply,
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
      logger?.info?.("dsh-wsl-im qq Gateway ready");
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
