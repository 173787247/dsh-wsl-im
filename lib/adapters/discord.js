/**
 * Discord Gateway v10 adapter.
 *   wss://gateway.discord.gg/?v=10&encoding=json
 *   Hello → Identify → Heartbeat; Dispatch MESSAGE_CREATE
 *   POST /api/v10/channels/{id}/messages
 *
 * Aligned with OryxOS DiscordGatewayClient / DiscordEventNormalizer / DiscordMessageSender.
 */

import WebSocket from "ws";
import { proxiedFetch, resolveWsProxyAgent, proxyLabel } from "../proxy.js";
import { downloadBytes } from "../download.js";
import { mediaUserText, toBridgePart } from "../inbound-media.js";

const GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const API = "https://discord.com/api/v10";
/** GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT */
const INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15);
const CHUNK = 1900;
const MENTION_RE = /<@!?\d+>\s*/g;
const FLAG_VOICE = 8192;

const CDN_OK = [
  /\.discordapp\.com$/i,
  /\.discordapp\.net$/i,
  /^cdn\.discordapp\.com$/i,
  /^media\.discordapp\.net$/i,
];

export function stripDiscordMentions(text) {
  return String(text || "").replace(MENTION_RE, "").trim();
}

export function mentionsDiscordBot(data, content, applicationId) {
  const appId = String(applicationId || "").trim();
  if (!appId) return false;
  const mentions = Array.isArray(data?.mentions) ? data.mentions : [];
  if (mentions.some((m) => String(m?.id) === appId)) return true;
  return new RegExp(`<@!?${appId}>`).test(String(content || ""));
}

/**
 * @returns {{ skip?: string, text?: string, userId?: string, chatId?: string, messageId?: string, isGroup?: boolean, files?: Array }}
 */
export function parseDiscordMessageCreate(data, { applicationId = "" } = {}) {
  if (!data || typeof data !== "object") return { skip: "empty" };
  if (data.author?.bot) return { skip: "bot" };
  if (data.webhook_id) return { skip: "webhook" };

  const userId = data.author?.id;
  const chatId = data.channel_id;
  const messageId = data.id;
  if (!userId || !chatId || !messageId) return { skip: "missing-fields" };

  let text = String(data.content || "").trim();
  const voiceMessage = (Number(data.flags) & FLAG_VOICE) !== 0;
  const files = extractDiscordAttachments(data.attachments, voiceMessage);
  const inGuild = Boolean(String(data.guild_id || "").trim());

  if (inGuild) {
    if (!mentionsDiscordBot(data, text, applicationId)) return { skip: "group-without-mention" };
    text = stripDiscordMentions(text);
    if (!text && !files.length) return { skip: "empty-body" };
    return { text, userId, chatId, messageId, isGroup: true, files };
  }

  if (!text && !files.length) return { skip: "empty-body" };
  return { text, userId, chatId, messageId, isGroup: false, files };
}

export function extractDiscordAttachments(attachments, voiceMessage = false) {
  if (!Array.isArray(attachments)) return [];
  const out = [];
  for (const file of attachments) {
    if (!file?.url) continue;
    const mime = String(file.content_type || "").toLowerCase();
    const name = file.filename || "discord-file";
    let kind = "file";
    if (mime.startsWith("image/")) kind = "image";
    else if (mime.startsWith("audio/") || voiceMessage || file.waveform) kind = "audio";
    else if (mime.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(name)) kind = "video";
    out.push({ kind, url: file.url, name, mime });
  }
  return out;
}

export function segmentDiscordText(text, chunkSize = CHUNK) {
  const t = String(text ?? "");
  if (!t.length) return [""];
  const parts = [];
  for (let i = 0; i < t.length; i += chunkSize) parts.push(t.slice(i, i + chunkSize));
  return parts;
}

function cdnOk(url) {
  try {
    const host = new URL(url).hostname;
    return CDN_OK.some((re) => re.test(host));
  } catch {
    return false;
  }
}

export function createDiscordAdapter({ botToken, applicationId: configuredAppId, onMessage, logger }) {
  let ws;
  let state = "down";
  let stopped = false;
  let heartbeat;
  let seq = null;
  let applicationId = String(configuredAppId || "").trim();
  let reconnectTimer;

  async function postMessage(channelId, content, replyTo) {
    const body = { content };
    if (replyTo) {
      body.message_reference = { message_id: replyTo, fail_if_not_exists: false };
    }
    const res = await proxiedFetch(`${API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`discord postMessage: ${res.status} ${err.slice(0, 120)}`);
    }
  }

  async function replyChunks(channelId, text, replyTo) {
    for (const chunk of segmentDiscordText(text, CHUNK)) {
      await postMessage(channelId, chunk, replyTo);
    }
  }

  function startHb(interval) {
    stopHb();
    heartbeat = setInterval(() => {
      try {
        ws?.send(JSON.stringify({ op: 1, d: seq }));
      } catch {
        /* ignore */
      }
    }, Math.max(1000, interval));
    heartbeat.unref?.();
  }

  function stopHb() {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
  }

  async function handleDispatch(t, d) {
    if (t === "READY") {
      if (d?.application?.id) applicationId = String(d.application.id);
      else if (d?.user?.id && !applicationId) applicationId = String(d.user.id);
      state = "up";
      return;
    }
    if (t !== "MESSAGE_CREATE") return;

    const parsed = parseDiscordMessageCreate(d, { applicationId });
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
          const bytes = await downloadBytes(item.url, { allow: cdnOk });
          const part = toBridgePart({
            kind: item.kind,
            name: item.name,
            data: bytes,
            fallbackName: item.name,
          });
          if (part.image) images.push(part.image);
          if (part.file) files.push(part.file);
        }
      } catch (e) {
        console.warn(`[dsh-wsl-im/discord] media failed: ${e?.message || e}`);
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
      platform: "discord",
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
    await new Promise((resolve, reject) => {
      ws = new WebSocket(GATEWAY, { agent: resolveWsProxyAgent() });
      let ready = false;

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
          const interval = msg.d?.heartbeat_interval || 41250;
          ws.send(
            JSON.stringify({
              op: 2,
              d: {
                token: botToken,
                intents: INTENTS,
                properties: { os: "linux", browser: "dsh-wsl-im", device: "dsh-wsl-im" },
              },
            }),
          );
          startHb(interval);
        } else if (op === 0) {
          const t = msg.t;
          handleDispatch(t, msg.d || {})
            .then(() => {
              if (t === "READY" && !ready) {
                ready = true;
                resolve();
              }
            })
            .catch((e) => logger?.warn?.(`discord dispatch: ${e.message}`));
        } else if (op === 7 || op === 9) {
          logger?.warn?.(`discord op=${op}, reconnecting`);
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
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            connect().catch((e) => logger?.warn?.(`discord reconnect: ${e.message}`));
          }, 5_000);
          reconnectTimer.unref?.();
        }
      });

      setTimeout(() => {
        if (!ready && state !== "up") reject(new Error("discord: READY timeout"));
      }, 25_000);
    });
  };

  return {
    name: "discord",
    state: () => state,
    detail: () => `gateway ${proxyLabel()}${applicationId ? ` app=${applicationId}` : ""}`,
    async start() {
      stopped = false;
      await connect();
      logger?.info?.("dsh-wsl-im discord Gateway ready");
    },
    stop() {
      stopped = true;
      state = "down";
      stopHb();
      clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
  };
}
