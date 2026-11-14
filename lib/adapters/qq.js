/**
 * QQ official bot Gateway adapter.
 * QQ official Gateway wire protocol.
 *   POST https://bots.qq.com/app/getAppAccessToken
 *   GET  https://api.bot.qq.com/gateway → WSS Identify (intent GROUP_AND_C2C_EVENT)
 */

import fs from "node:fs/promises";
import WebSocket from "ws";
import { proxiedFetch, resolveWsProxyAgent } from "../proxy.js";
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

export function createQqAdapter({ appId, appSecret, onMessage, logger, voiceReply = false, voiceReplyLang = "auto" }) {
  let ws;
  let state = "down";
  let stopped = false;
  let accessToken = "";
  let heartbeat;
  let sessionId;
  let seq = null;

  async function refreshToken() {
    const res = await proxiedFetch(TOKEN_URL, {
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
    const res = await proxiedFetch(`${API}/gateway`, {
      headers: { Authorization: `QQBot ${accessToken}` },
    });
    const json = await res.json();
    const url = json.url;
    if (!url) throw new Error(`qq gateway: ${JSON.stringify(json)}`);
    return url;
  }

  async function sendC2C(openid, content, msgId) {
    await refreshToken();
    // 不带 msg_id：走主动消息。
    // 带 msg_id 是被动回复，QQ 对这个有额外校验（code 40034024
    // "请求参数msg_id无效或越权"），失败时接口返回非 200 而调用方
    // 只打了日志 —— 用户那头就是**收不到文字**。
    // 语音一直是这么发的，所以语音正常、文字丢。
    void msgId;
    await proxiedFetch(`${API}/v2/users/${openid}/messages`, {
      method: "POST",
      headers: {
        Authorization: `QQBot ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content, msg_type: 0 }),
    });
  }

  async function sendGroup(groupOpenid, content, msgId) {
    await refreshToken();
    // 同 sendC2C：不带 msg_id，避免被动回复的额外校验。
    void msgId;
    await proxiedFetch(`${API}/v2/groups/${groupOpenid}/messages`, {
      method: "POST",
      headers: {
        Authorization: `QQBot ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content, msg_type: 0 }),
    });
  }

  /**
   * Upload a WAV and send it as a QQ voice message (file_type 3 + msg_type 7).
   * The API accepted a plain WAV during testing, so no SILK transcode here.
   */
  async function uploadVoice(target, filePath) {
    await refreshToken();
    const buf = await fs.readFile(filePath);
    const up = await proxiedFetch(`${target}/files`, {
      method: "POST",
      headers: {
        Authorization: `QQBot ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file_type: 3,
        file_data: buf.toString("base64"),
        srv_send_msg: false,
      }),
    });
    if (!up.ok) {
      throw new Error(`voice upload ${up.status}: ${(await up.text()).slice(0, 200)}`);
    }
    const { file_info: fileInfo } = await up.json();
    if (!fileInfo) throw new Error("voice upload returned no file_info");
    return fileInfo;
  }

  async function sendVoiceC2C(openid, filePath, text, msgId) {
    const fileInfo = await uploadVoice(`${API}/v2/users/${openid}`, filePath);
    await proxiedFetch(`${API}/v2/users/${openid}/messages`, {
      method: "POST",
      headers: {
        Authorization: `QQBot ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: text || " ",
        msg_type: 7,
        media: { file_info: fileInfo },
        // 不带 msg_id：语音作为独立消息发出。
        // 带 msg_id 走的是被动回复，QQ 有时间窗口，过期后接口 200 但
        // 不投递 —— 实测发得出去、手机上收不到。
      }),
    });
  }

  async function sendVoiceGroup(groupOpenid, filePath, text, msgId) {
    const fileInfo = await uploadVoice(`${API}/v2/groups/${groupOpenid}`, filePath);
    await proxiedFetch(`${API}/v2/groups/${groupOpenid}/messages`, {
      method: "POST",
      headers: {
        Authorization: `QQBot ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: text || " ",
        msg_type: 7,
        media: { file_info: fileInfo },
      }),
    });
  }

  // 重连用指数退避，而且**永不放弃**。
  // 旧实现是 connect().catch(log)，一旦那次重连失败（代理断开、token 过期）
  // 就再也不重试了 —— 通道从此静默死掉，直到进程重启。
  let reconnectAttempt = 0;
  let reconnectTimer;
  function scheduleReconnect() {
    if (stopped) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const delay = Math.min(5_000 * 2 ** reconnectAttempt, 60_000);
    reconnectAttempt += 1;
    logger?.warn?.(`qq reconnect in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempt})`);
    reconnectTimer = setTimeout(async () => {
      try {
        await connect();
        reconnectAttempt = 0;
        logger?.info?.("qq reconnected");
      } catch (e) {
        logger?.warn?.(`qq reconnect failed: ${e.message}`);
        scheduleReconnect();
      }
    }, delay);
    reconnectTimer.unref?.();
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
        if (!stopped) scheduleReconnect();
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
      const target = d.author?.user_openid || d.author?.id || d.openid;
      if (isGroup) await sendGroup(d.group_openid, replyText, msgId);
      else await sendC2C(target, replyText, msgId);

      // Text first, then the voice clip. A TTS failure must never swallow the
      // text reply, so this block is deliberately best-effort.
      if (!voiceReply) return;
      let clip;
      try {
        const { synthesize, cleanup } = await import("../tts.js");
        const r = await synthesize(replyText, { lang: voiceReplyLang });
        if (!r.ok) {
          console.warn(`[dsh-wsl-im/qq] tts skipped: ${r.error}`);
          return;
        }
        clip = r.path;
        if (isGroup) await sendVoiceGroup(d.group_openid, clip, "", msgId);
        else await sendVoiceC2C(target, clip, "", msgId);
      } catch (e) {
        console.warn(`[dsh-wsl-im/qq] voice reply failed: ${e?.message || e}`);
      } finally {
        try {
          const { cleanup } = await import("../tts.js");
          await cleanup(clip);
        } catch {
          /* ignore */
        }
      }
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
    // 独立机器人（tools/voice-bot.mjs）用它直接发语音，
    // 不经过 dsh 的 agent —— 那条路一次要几十秒。
    const replyVoice = async (filePath) => {
      const target = d.author?.user_openid || d.author?.id || d.openid;
      if (isGroup) await sendVoiceGroup(d.group_openid, filePath, "", msgId);
      else await sendVoiceC2C(target, filePath, "", msgId);
    };

    await onMessage({
      platform: "qq",
      chatId: String(chatId),
      userId: String(userId),
      text,
      images,
      files,
      messageId: String(msgId || Date.now()),
      reply,
      replyVoice,
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
