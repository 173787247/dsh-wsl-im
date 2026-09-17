/**
 * Feishu long-connection adapter.
 * Independent rewrite (Lark WS + im.message.receive_v1).
 * OryxOS was a behavior reference only; this file does not include its code.
 * See docs/PROVENANCE.md.
 * Inbound image/file/audio/media: GetMessageResource (message_id + file_key).
 * Uses @larksuiteoapi/node-sdk when available; otherwise fails with install hint.
 */

import { readLimitedStream } from "../download.js";
import { mediaUserText, toBridgePart } from "../inbound-media.js";
import { proxyLabel, resolveWsProxyAgent } from "../proxy.js";

const OPEN = "https://open.feishu.cn";

export function extractText(event) {
  const message = event?.event?.message ?? event?.message;
  const parsed = parseFeishuMessage(message);
  return parsed.text || undefined;
}

/** Parse Feishu event message into text and/or a resource ref (no network). */
export function parseFeishuMessage(message) {
  if (!message) return {};
  let content = {};
  try {
    content =
      typeof message.content === "string" ? JSON.parse(message.content) : message.content || {};
  } catch {
    content = {};
  }
  const type = message.message_type;
  if (type === "text") {
    return { text: typeof content.text === "string" ? content.text : "" };
  }
  if (type === "image" && content.image_key) {
    return {
      resource: {
        key: content.image_key,
        resourceType: "image",
        kind: "image",
        name: "feishu-image",
      },
    };
  }
  if ((type === "file" || type === "audio" || type === "media") && content.file_key) {
    const kind = type === "audio" ? "audio" : type === "media" ? "video" : "file";
    const fallback = kind === "audio" ? "feishu-voice" : kind === "video" ? "feishu-video" : "feishu-file";
    return {
      resource: {
        key: content.file_key,
        resourceType: "file",
        kind,
        name: content.file_name || fallback,
      },
    };
  }
  if (type && type !== "text") return { unsupported: type };
  return { text: "" };
}

/** Group chats: skip when Feishu did not include a mention. */
export function feishuGroupMentioned(message) {
  if (message?.chat_type !== "group") return true;
  const mentions = message.mentions;
  return Array.isArray(mentions) && mentions.length > 0;
}

export function createFeishuAdapter({ appId, appSecret, onMessage, logger }) {
  let wsClient;
  let apiClient;
  let state = "down";
  const seen = new Set();

  async function sendText(chatId, text) {
    await apiClient.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    });
  }

  async function downloadResource(messageId, fileKey, resourceType) {
    const payload = {
      params: { type: resourceType },
      path: { message_id: messageId, file_key: fileKey },
    };
    const im = apiClient.im;
    const resource = im?.messageResource || im?.v1?.messageResource;
    if (!resource?.get) throw new Error("feishu: SDK missing im.messageResource.get");
    const res = await resource.get(payload);
    const stream = res?.getReadableStream?.();
    if (!stream) throw new Error("feishu: resource response has no stream");
    return readLimitedStream(stream);
  }

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

      const agent = resolveWsProxyAgent();
      if (agent && Lark.defaultHttpInstance) {
        Lark.defaultHttpInstance.defaults.httpsAgent = agent;
        Lark.defaultHttpInstance.defaults.httpAgent = agent;
        Lark.defaultHttpInstance.defaults.proxy = false;
      }

      apiClient = new Lark.Client({
        appId,
        appSecret,
        appType: Lark.AppType.SelfBuild,
        domain: Lark.Domain.Feishu,
      });

      const dispatcher = new Lark.EventDispatcher({}).register({
        "im.message.receive_v1": async (data) => {
          const message = data.message;
          const msgId = message?.message_id;
          if (msgId && seen.has(msgId)) return;
          if (msgId) {
            seen.add(msgId);
            if (seen.size > 2000) seen.clear();
          }
          if (!feishuGroupMentioned(message)) {
            logger?.info?.("feishu: group message without mention, ignored");
            return;
          }
          const parsed = parseFeishuMessage(message);
          if (parsed.unsupported) {
            logger?.info?.(`feishu: unsupported message_type=${parsed.unsupported}`);
            return;
          }
          const chatId = message?.chat_id;
          const userId =
            data.sender?.sender_id?.open_id || data.sender?.sender_id?.user_id || "unknown";
          let text = String(parsed.text || "").replace(/@_user_\d+/g, "").trim();
          const images = [];
          const files = [];
          if (parsed.resource) {
            try {
              const bytes = await downloadResource(
                msgId,
                parsed.resource.key,
                parsed.resource.resourceType,
              );
              const part = toBridgePart({
                kind: parsed.resource.kind,
                name: parsed.resource.name,
                data: bytes,
                fallbackName: parsed.resource.name,
              });
              if (part.image) images.push(part.image);
              if (part.file) files.push(part.file);
              console.info(
                `[dsh-wsl-im/feishu] ${parsed.resource.kind} resolved name=${part.name} bytes=${bytes.length}`,
              );
              if (!text) text = mediaUserText({ kind: parsed.resource.kind, name: part.name });
            } catch (e) {
              console.warn(`[dsh-wsl-im/feishu] media resolve failed: ${e?.message || e}`);
              if (chatId) {
                await sendText(
                  chatId,
                  `⚠️ 附件下载失败: ${e instanceof Error ? e.message : String(e)}`,
                ).catch(() => {});
              }
              return;
            }
          }
          if (!text && images.length === 0 && files.length === 0) return;
          if (!chatId) return;
          await onMessage({
            platform: "feishu",
            chatId,
            userId,
            text,
            images,
            files,
            messageId: msgId,
            reply: async (body) => {
              await sendText(chatId, body);
            },
          });
        },
      });

      wsClient = new Lark.WSClient({
        appId,
        appSecret,
        domain: Lark.Domain.Feishu,
        loggerLevel: Lark.LoggerLevel.info,
        agent,
      });
      await wsClient.start({ eventDispatcher: dispatcher });
      state = "up";
      logger?.info?.(
        `dsh-wsl-im feishu WS client started (long connection, ${proxyLabel()})`,
      );
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
