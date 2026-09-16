/**
 * DingTalk Stream adapter.
 * Protocol reference: OryxOS DingTalkStreamClient
 *   POST https://api.dingtalk.com/v1.0/gateway/connections/open
 *   topic /v1.0/im/bot/messages/get → sessionWebhook reply
 */

import WebSocket from "ws";
import { resolveWsProxyAgent } from "../proxy.js";
import { downloadBytes, postJson } from "../download.js";
import {
  DING_MEDIA_HOSTS,
  asrText,
  hostAllowed,
  mediaUserText,
  toBridgePart,
} from "../inbound-media.js";

const API = "https://api.dingtalk.com";
const TOPIC_BOT = "/v1.0/im/bot/messages/get";

/**
 * Parse a DingTalk Stream bot callback (no network).
 * picture/file/audio/video use content.downloadCode or a direct https URL.
 */
export function parseDingMessage(data) {
  if (!data) return { skip: "empty" };
  const group = String(data.conversationType) === "2";
  const at = data.isInAtList === true || data.isInAtList === "true";
  if (group && !at) return { skip: "group-not-at" };
  const msgtype = data.msgtype;
  if (msgtype === "text" || (!msgtype && data.text?.content)) {
    let text = String(data.text?.content || "").trim();
    if (group) text = text.replace(/^@\S+\s*/, "").trim();
    return { text };
  }
  const content = data.content && typeof data.content === "object" ? data.content : {};
  const kind = { picture: "image", file: "file", audio: "audio", video: "video" }[msgtype];
  if (!kind) return { unsupported: msgtype || "unknown" };
  const name =
    content.fileName ||
    content.file_name ||
    (kind === "image" ? "dingtalk-image" : kind === "audio" ? "dingtalk-voice" : kind === "video" ? "dingtalk-video" : "dingtalk-file");
  const url = content.picURL || content.downloadUrl || content.fileUrl || "";
  const downloadCode = content.downloadCode || content.pictureDownloadCode || "";
  const recognition = typeof content.recognition === "string" ? content.recognition : "";
  if (!url && !downloadCode) return { unsupported: `${msgtype}-no-ref` };
  return { media: { kind, url, downloadCode, name, recognition } };
}

export function createDingtalkAdapter({ clientId, clientSecret, onMessage, logger }) {
  let ws;
  let state = "down";
  let stopped = false;
  let tokenCache = { token: "", exp: 0 };

  async function accessToken() {
    if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
    const json = await postJson(`${API}/v1.0/oauth2/accessToken`, {
      appKey: clientId,
      appSecret: clientSecret,
    });
    const token = json.accessToken;
    if (!token) throw new Error("dingtalk: oauth2 missing accessToken");
    const expireIn = Number(json.expireIn) || 7200;
    tokenCache = { token, exp: Date.now() + Math.max(60, expireIn - 120) * 1000 };
    return token;
  }

  async function resolveMediaUrl(media) {
    if (media.url && /^https:\/\//i.test(media.url)) return media.url;
    if (!media.downloadCode) throw new Error("dingtalk media: missing downloadCode");
    const token = await accessToken();
    const json = await postJson(
      `${API}/v1.0/robot/messageFiles/download`,
      { downloadCode: media.downloadCode, robotCode: clientId },
      { headers: { "x-acs-dingtalk-access-token": token } },
    );
    const url = json.downloadUrl;
    if (!url) throw new Error("dingtalk media: missing downloadUrl");
    return url;
  }

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
        ua: "dsh-wsl-im/0.2.3",
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
      ws = new WebSocket(url, { agent: resolveWsProxyAgent() });
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
      const parsed = parseDingMessage(data);
      if (parsed.skip) {
        if (parsed.skip === "group-not-at") {
          logger?.info?.("dingtalk: group message without @, ignored");
        }
        return;
      }
      if (parsed.unsupported) {
        logger?.info?.(`dingtalk: unsupported ${parsed.unsupported}`);
        return;
      }
      const chatId = data.conversationId || data.chatbotCorpId || data.senderId || "dingtalk";
      const userId = data.senderStaffId || data.senderId || "unknown";
      const sessionWebhook = data.sessionWebhook;
      const reply = async (replyText) => {
        if (!sessionWebhook) throw new Error("dingtalk: no sessionWebhook");
        await fetch(sessionWebhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            msgtype: "text",
            text: { content: replyText },
          }),
        });
      };
      let text = parsed.text || "";
      const images = [];
      const files = [];
      if (parsed.media) {
        const asr = parsed.media.kind === "audio" ? asrText(parsed.media.recognition) : "";
        try {
          const url = await resolveMediaUrl(parsed.media);
          const mediaUrl = new URL(url);
          console.info(
            `[dsh-wsl-im/dingtalk] media fetch scheme=${mediaUrl.protocol} host=${mediaUrl.hostname}`,
          );
          const bytes = await downloadBytes(url, {
            allowHttp: true,
            allow: (u) => hostAllowed(u, DING_MEDIA_HOSTS),
          });
          const part = toBridgePart({
            kind: parsed.media.kind,
            name: parsed.media.name,
            data: bytes,
            fallbackName: parsed.media.name,
          });
          if (part.image) images.push(part.image);
          if (part.file) files.push(part.file);
          console.info(
            `[dsh-wsl-im/dingtalk] ${parsed.media.kind} resolved name=${part.name} bytes=${bytes.length}`,
          );
          if (asr) text = asr;
          else if (!text) text = mediaUserText({ kind: parsed.media.kind, name: part.name });
        } catch (e) {
          console.warn(`[dsh-wsl-im/dingtalk] media resolve failed: ${e?.message || e}`);
          await reply(`⚠️ 附件下载失败: ${e instanceof Error ? e.message : String(e)}`).catch(() => {});
          return;
        }
      }
      if (!text && images.length === 0 && files.length === 0) return;
      await onMessage({
        platform: "dingtalk",
        chatId: String(chatId),
        userId: String(userId),
        text,
        images,
        files,
        messageId: String(data.msgId || data.messageId || Date.now()),
        reply,
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
