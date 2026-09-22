/**
 * Telegram Bot API long-poll adapter (outbound only — no webhook).
 *   getUpdates → message / edited_message
 *   sendMessage
 *
 * Aligned with OryxOS TelegramChannelAdapter / TelegramEventNormalizer / TelegramMessageSender.
 */

import { mediaUserText, toBridgePart } from "../inbound-media.js";
import { downloadBytes } from "../download.js";

const API_BASE = "https://api.telegram.org";
const CHUNK = 3500;
const POLL_TIMEOUT_SEC = 30;

export function stripAt(name) {
  return String(name || "").replace(/^@/, "").trim();
}

export function stripTelegramMentions(text) {
  return String(text || "")
    .replace(/@[A-Za-z0-9_]+\s*/g, "")
    .trim();
}

export function mentionsTelegramBot(message, text, botUsername) {
  const uname = stripAt(botUsername).toLowerCase();
  if (!uname) return false;
  const needle = `@${uname}`.toLowerCase();
  if (String(text || "").toLowerCase().includes(needle)) return true;
  const entities = [
    ...(Array.isArray(message?.entities) ? message.entities : []),
    ...(Array.isArray(message?.caption_entities) ? message.caption_entities : []),
  ];
  const body = String(text || message?.text || message?.caption || "");
  for (const ent of entities) {
    if (ent?.type === "mention") {
      const slice = body.slice(ent.offset, ent.offset + ent.length).toLowerCase();
      if (slice === needle) return true;
    }
    if (ent?.type === "text_mention" && stripAt(ent.user?.username).toLowerCase() === uname) {
      return true;
    }
  }
  return false;
}

/**
 * Normalize a Telegram Update object.
 * @returns {{ skip?: string, text?: string, userId?: string, chatId?: string, messageId?: string, isGroup?: boolean, fileIds?: Array }}
 */
export function parseTelegramUpdate(update, { botUsername = "" } = {}) {
  if (!update || typeof update !== "object") return { skip: "empty" };
  let message = update.message;
  if (!message || typeof message !== "object") message = update.edited_message;
  if (!message || typeof message !== "object") return { skip: "no-message" };

  if (message.from?.is_bot) return { skip: "bot" };
  const userId = message.from?.id;
  const chatId = message.chat?.id;
  const messageId = message.message_id;
  if (userId == null || chatId == null || messageId == null) return { skip: "missing-fields" };

  const chatType = String(message.chat?.type || "");
  const isGroup = chatType === "group" || chatType === "supergroup";
  let text = String(message.text || "").trim();
  if (!text) text = String(message.caption || "").trim();

  const fileIds = extractTelegramFileIds(message);

  if (isGroup) {
    if (!mentionsTelegramBot(message, text, botUsername)) return { skip: "group-without-mention" };
    text = stripTelegramMentions(text);
    if (!text && !fileIds.length) return { skip: "empty-body" };
    return { text, userId: String(userId), chatId: String(chatId), messageId: String(messageId), isGroup: true, fileIds };
  }

  if (!text && !fileIds.length) return { skip: "empty-body" };
  return { text, userId: String(userId), chatId: String(chatId), messageId: String(messageId), isGroup: false, fileIds };
}

export function extractTelegramFileIds(message) {
  const out = [];
  if (!message || typeof message !== "object") return out;
  if (Array.isArray(message.photo) && message.photo.length) {
    const best = message.photo[message.photo.length - 1];
    if (best?.file_id) out.push({ kind: "image", fileId: best.file_id, name: "photo.jpg" });
  }
  if (message.document?.file_id) {
    const mime = String(message.document.mime_type || "");
    let kind = "file";
    if (mime.startsWith("image/")) kind = "image";
    else if (mime.startsWith("audio/")) kind = "audio";
    else if (mime.startsWith("video/")) kind = "video";
    out.push({
      kind,
      fileId: message.document.file_id,
      name: message.document.file_name || "document",
      mime,
    });
  }
  if (message.voice?.file_id) {
    out.push({ kind: "audio", fileId: message.voice.file_id, name: "voice.ogg", mime: "audio/ogg" });
  }
  if (message.audio?.file_id) {
    out.push({
      kind: "audio",
      fileId: message.audio.file_id,
      name: message.audio.file_name || "audio",
      mime: message.audio.mime_type,
    });
  }
  if (message.video?.file_id) {
    out.push({
      kind: "video",
      fileId: message.video.file_id,
      name: message.video.file_name || "video.mp4",
      mime: message.video.mime_type || "video/mp4",
    });
  }
  return out;
}

export function segmentTelegramText(text, chunkSize = CHUNK) {
  const t = String(text ?? "");
  if (!t.length) return [""];
  const parts = [];
  for (let i = 0; i < t.length; i += chunkSize) parts.push(t.slice(i, i + chunkSize));
  return parts;
}

function tgHostOk(url) {
  try {
    const host = new URL(url).hostname;
    return host === "api.telegram.org" || host.endsWith(".telegram.org");
  } catch {
    return false;
  }
}

export function createTelegramAdapter({ botToken, botUsername = "", onMessage, logger }) {
  let state = "down";
  let stopped = false;
  let offset = 0;
  let loopPromise;
  const uname = stripAt(botUsername);

  async function api(method, body) {
    const url = `${API_BASE}/bot${botToken}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      throw new Error(`telegram ${method}: ${json.description || res.status}`);
    }
    return json.result;
  }

  async function sendMessage(chatId, text, replyTo) {
    const body = { chat_id: chatId, text };
    if (replyTo) body.reply_to_message_id = Number(replyTo) || replyTo;
    await api("sendMessage", body);
  }

  async function replyChunks(chatId, text, replyTo) {
    for (const chunk of segmentTelegramText(text, CHUNK)) {
      await sendMessage(chatId, chunk, replyTo);
    }
  }

  async function resolveFile(fileId) {
    const meta = await api("getFile", { file_id: fileId });
    const path = meta?.file_path;
    if (!path) throw new Error("telegram getFile: missing file_path");
    const url = `${API_BASE}/file/bot${botToken}/${path}`;
    return downloadBytes(url, { allow: tgHostOk });
  }

  async function handleUpdate(update) {
    const parsed = parseTelegramUpdate(update, { botUsername: uname });
    if (parsed.skip) return;

    const reply = async (replyText) => {
      await replyChunks(parsed.chatId, replyText, parsed.isGroup ? parsed.messageId : undefined);
    };

    let text = parsed.text || "";
    const images = [];
    const files = [];

    if (parsed.fileIds?.length) {
      try {
        for (const item of parsed.fileIds) {
          const bytes = await resolveFile(item.fileId);
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
        console.warn(`[dsh-wsl-im/telegram] media failed: ${e?.message || e}`);
        await reply(`⚠️ 附件下载失败: ${e instanceof Error ? e.message : String(e)}`).catch(() => {});
        return;
      }
    }

    if (!text && files.length) {
      const audio = parsed.fileIds.find((f) => f.kind === "audio");
      const video = parsed.fileIds.find((f) => f.kind === "video");
      const named = files[0]?.name || "附件";
      if (audio) text = mediaUserText({ kind: "audio", name: named });
      else if (video) text = mediaUserText({ kind: "video", name: named });
      else text = mediaUserText({ kind: "file", name: named });
    } else if (!text && images.length) {
      text = mediaUserText({ kind: "image", name: "图片" });
    }

    if (!text && images.length === 0 && files.length === 0) return;

    await onMessage({
      platform: "telegram",
      chatId: parsed.chatId,
      userId: parsed.userId,
      text,
      images,
      files,
      messageId: parsed.messageId,
      reply,
    });
  }

  async function pollLoop() {
    state = "up";
    while (!stopped) {
      try {
        const result = await api("getUpdates", {
          offset,
          timeout: POLL_TIMEOUT_SEC,
          allowed_updates: ["message", "edited_message"],
        });
        if (Array.isArray(result)) {
          for (const update of result) {
            const id = Number(update.update_id) || 0;
            if (id >= offset) offset = id + 1;
            await handleUpdate(update).catch((e) =>
              logger?.warn?.(`telegram update: ${e.message}`),
            );
          }
        }
      } catch (e) {
        if (stopped) break;
        logger?.warn?.(`telegram poll: ${e.message}`);
        await new Promise((r) => setTimeout(r, 3_000));
      }
    }
    state = "down";
  }

  return {
    name: "telegram",
    state: () => state,
    detail: () => `getUpdates${uname ? ` @${uname}` : ""}`,
    async start() {
      stopped = false;
      await api("getMe", {});
      loopPromise = pollLoop();
      logger?.info?.("dsh-wsl-im telegram long-poll ready");
    },
    stop() {
      stopped = true;
      state = "down";
    },
  };
}
