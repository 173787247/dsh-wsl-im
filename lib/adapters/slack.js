/**
 * Slack Socket Mode adapter.
 *   POST https://slack.com/api/apps.connections.open  (App token xapp-)
 *   WSS  → events_api envelopes (ack by envelope_id)
 *   POST https://slack.com/api/chat.postMessage       (Bot token xoxb-)
 *
 * Protocol aligned with OryxOS SlackSocketClient / SlackEventNormalizer / SlackMessageSender.
 */

import WebSocket from "ws";
import { resolveWsProxyAgent, proxyLabel } from "../proxy.js";
import { downloadBytes } from "../download.js";
import { mediaUserText, toBridgePart } from "../inbound-media.js";

const API = "https://slack.com/api";
const CHUNK = 3500;
const MENTION_RE = /<@[A-Z0-9]+>\s*/g;
const ALLOWED_SUBTYPES = new Set(["file_share"]);

/** Hosts for Slack private file URLs (files.slack.com / …). */
const SLACK_FILE_HOSTS = [/\.slack\.com$/i, /^files\.slack\.com$/i, /^slack-files\.com$/i];

export function stripSlackMentions(text) {
  return String(text || "").replace(MENTION_RE, "").trim();
}

export function shouldDropSlackEvent(event) {
  if (!event || typeof event !== "object") return true;
  if (event.bot_id) return true;
  const subtype = String(event.subtype || "").trim();
  if (!subtype) return false;
  return !ALLOWED_SUBTYPES.has(subtype);
}

/**
 * Normalize a Slack Events API `event` object (not the Socket Mode envelope).
 * @returns {{ skip?: string, text?: string, userId?: string, chatId?: string, messageId?: string, isGroup?: boolean, files?: Array }}
 */
export function parseSlackEvent(event) {
  if (!event || typeof event !== "object") return { skip: "empty" };
  if (shouldDropSlackEvent(event)) return { skip: "bot-or-subtype" };

  const type = String(event.type || "");
  if (type === "app_mention") {
    const userId = event.user;
    const chatId = event.channel;
    const messageId = event.ts;
    if (!userId || !chatId || !messageId) return { skip: "missing-fields" };
    const text = stripSlackMentions(event.text);
    const files = extractSlackFiles(event.files);
    if (!text && !files.length) return { skip: "empty-body" };
    return { text, userId, chatId, messageId, isGroup: true, files };
  }

  if (type === "message") {
    const channelType = String(event.channel_type || "");
    const dm = channelType === "im" || channelType === "mpim";
    if (!dm) return { skip: "group-without-mention" };
    const userId = event.user;
    const chatId = event.channel;
    const messageId = event.ts;
    if (!userId || !chatId || !messageId) return { skip: "missing-fields" };
    const text = String(event.text || "").trim();
    const files = extractSlackFiles(event.files);
    if (!text && !files.length) return { skip: "empty-body" };
    return { text, userId, chatId, messageId, isGroup: false, files };
  }

  return { skip: "event" };
}

export function extractSlackFiles(files) {
  if (!Array.isArray(files)) return [];
  const out = [];
  for (const file of files) {
    if (!file || typeof file !== "object") continue;
    const url = file.url_private_download || file.url_private;
    if (!url) continue;
    const mime = String(file.mimetype || "").toLowerCase();
    const name = file.name || file.title || "slack-file";
    let kind = "file";
    if (mime.startsWith("image/")) kind = "image";
    else if (mime.startsWith("audio/")) kind = "audio";
    else if (mime.startsWith("video/")) kind = "video";
    out.push({ kind, url, name, mime });
  }
  return out;
}

export function segmentSlackText(text, chunkSize = CHUNK) {
  const t = String(text ?? "");
  if (!t.length) return [""];
  const parts = [];
  for (let i = 0; i < t.length; i += chunkSize) {
    parts.push(t.slice(i, i + chunkSize));
  }
  return parts;
}

function slackFileHostOk(url) {
  try {
    const host = new URL(url).hostname;
    return SLACK_FILE_HOSTS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

export function createSlackAdapter({ botToken, appToken, onMessage, logger }) {
  let ws;
  let state = "down";
  let stopped = false;
  let reconnectTimer;

  async function connectionsOpen() {
    const res = await fetch(`${API}/apps.connections.open`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok || !json.url) {
      throw new Error(`slack connections.open: ${json.error || res.status}`);
    }
    return json.url;
  }

  async function postMessage(channel, text, threadTs) {
    const body = { channel, text };
    if (threadTs) body.thread_ts = threadTs;
    const res = await fetch(`${API}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      throw new Error(`slack chat.postMessage: ${json.error || res.status}`);
    }
  }

  async function replyChunks(channel, text, threadTs) {
    for (const chunk of segmentSlackText(text, CHUNK)) {
      await postMessage(channel, chunk, threadTs);
    }
  }

  function ack(envelopeId) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !envelopeId) return;
    try {
      ws.send(JSON.stringify({ envelope_id: envelopeId }));
    } catch {
      /* ignore */
    }
  }

  async function handleEnvelope(root) {
    const type = String(root.type || "");
    const envelopeId = String(root.envelope_id || "");
    if (type === "hello") return;
    if (type === "disconnect") {
      logger?.info?.(`slack disconnect: ${root.reason || ""}`);
      ack(envelopeId);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      return;
    }
    if (type !== "events_api") return;
    ack(envelopeId);
    const event = root.payload?.event;
    if (!event || typeof event !== "object") return;
    await handleEvent(event);
  }

  async function handleEvent(event) {
    const parsed = parseSlackEvent(event);
    if (parsed.skip) return;

    const reply = async (replyText) => {
      await replyChunks(parsed.chatId, replyText, parsed.isGroup ? parsed.messageId : undefined);
    };

    let text = parsed.text || "";
    const images = [];
    const files = [];

    if (parsed.files?.length) {
      try {
        for (const item of parsed.files) {
          const bytes = await downloadBytes(item.url, {
            headers: { Authorization: `Bearer ${botToken}` },
            allow: slackFileHostOk,
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
            `[dsh-wsl-im/slack] ${item.kind} resolved name=${part.name} bytes=${bytes.length}`,
          );
        }
      } catch (e) {
        console.warn(`[dsh-wsl-im/slack] media resolve failed: ${e?.message || e}`);
        await reply(`⚠️ 附件下载失败: ${e instanceof Error ? e.message : String(e)}`).catch(() => {});
        return;
      }
    }

    if (!text && files.length) {
      const audio = parsed.files.find((f) => f.kind === "audio");
      const video = parsed.files.find((f) => f.kind === "video");
      const named = files[0]?.name || "附件";
      if (audio) text = mediaUserText({ kind: "audio", name: named });
      else if (video) text = mediaUserText({ kind: "video", name: named });
      else text = mediaUserText({ kind: "file", name: named });
    } else if (!text && images.length) {
      text = mediaUserText({ kind: "image", name: "图片" });
    }

    if (!text && images.length === 0 && files.length === 0) return;

    await onMessage({
      platform: "slack",
      chatId: String(parsed.chatId),
      userId: String(parsed.userId),
      text,
      images,
      files,
      messageId: String(parsed.messageId),
      reply,
    });
  }

  const connect = async () => {
    const url = await connectionsOpen();
    await new Promise((resolve, reject) => {
      ws = new WebSocket(url, { agent: resolveWsProxyAgent() });
      let opened = false;

      ws.on("open", () => {
        opened = true;
        state = "up";
        resolve();
      });

      ws.on("message", (raw) => {
        let root;
        try {
          root = JSON.parse(String(raw));
        } catch {
          return;
        }
        handleEnvelope(root).catch((e) => logger?.warn?.(`slack envelope: ${e.message}`));
      });

      ws.once("error", (err) => {
        if (!opened) reject(err);
        else logger?.warn?.(`slack ws error: ${err?.message || err}`);
      });

      ws.on("close", () => {
        state = "down";
        if (!stopped) {
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            connect().catch((e) => logger?.warn?.(`slack reconnect: ${e.message}`));
          }, 5_000);
          reconnectTimer.unref?.();
        }
      });

      setTimeout(() => {
        if (!opened && state !== "up") reject(new Error("slack: open timeout"));
      }, 25_000);
    });
  };

  return {
    name: "slack",
    state: () => state,
    detail: () => `socket-mode ${proxyLabel()}`,
    async start() {
      stopped = false;
      await connect();
      logger?.info?.("dsh-wsl-im slack Socket Mode ready");
    },
    stop() {
      stopped = true;
      state = "down";
      clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
  };
}
