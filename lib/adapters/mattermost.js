/**
 * Mattermost Outgoing Webhook listener + Bot REST reply.
 *   POST webhookPath ← MM Outgoing Webhook (form or JSON)
 *   POST {baseUrl}/api/v4/posts  (Bearer bot token) → reply
 *
 * Unlike Feishu/WeCom long connections, this needs an inbound HTTP port
 * (WSL port-forward / tunnel if Mattermost cannot reach the host).
 */

import { createServer } from "node:http";
import { URL } from "node:url";
import { proxiedFetch } from "../proxy.js";

const CHUNK = 4000;

/**
 * Parse Outgoing Webhook body (application/x-www-form-urlencoded or JSON).
 * @returns {{ skip?: string, text?: string, userId?: string, chatId?: string, messageId?: string, userName?: string, triggerWord?: string, token?: string }}
 */
export function parseMattermostWebhook(raw, { contentType = "" } = {}) {
  if (raw == null) return { skip: "empty" };
  let fields = {};
  const ct = String(contentType || "").toLowerCase();
  if (typeof raw === "object" && !Buffer.isBuffer(raw)) {
    fields = { ...raw };
  } else {
    const body = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw || "");
    if (!body.trim()) return { skip: "empty" };
    if (ct.includes("json") || body.trimStart().startsWith("{")) {
      try {
        fields = JSON.parse(body);
      } catch {
        return { skip: "bad-json" };
      }
    } else {
      fields = Object.fromEntries(new URLSearchParams(body));
    }
  }

  const text = String(fields.text || "").trim();
  const userId = String(fields.user_id || "").trim();
  const chatId = String(fields.channel_id || "").trim();
  const messageId = String(fields.post_id || "").trim();
  if (!chatId) return { skip: "missing-channel" };
  if (!userId) return { skip: "missing-user" };
  if (!text) return { skip: "empty-body" };

  return {
    text,
    userId,
    chatId,
    messageId: messageId || String(Date.now()),
    userName: String(fields.user_name || "").trim(),
    triggerWord: String(fields.trigger_word || "").trim(),
    token: String(fields.token || "").trim(),
  };
}

/** Strip trigger word prefix when present at start of text. */
export function stripMattermostTrigger(text, triggerWord) {
  const t = String(text || "").trim();
  const tw = String(triggerWord || "").trim();
  if (!tw) return t;
  if (t.toLowerCase().startsWith(tw.toLowerCase())) {
    return t.slice(tw.length).trim();
  }
  return t;
}

export function segmentMattermostText(text, max = CHUNK) {
  const t = String(text || "");
  if (t.length <= max) return [t];
  const chunks = [];
  let rest = t;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * @param {{ baseUrl: string, botToken: string, channelId: string, message: string, rootId?: string }} opts
 */
export async function postMattermostMessage({ baseUrl, botToken, channelId, message, rootId }) {
  const root = String(baseUrl || "").replace(/\/$/, "");
  if (!root) throw new Error("mattermost: baseUrl required");
  if (!botToken) throw new Error("mattermost: botToken required");
  const body = { channel_id: String(channelId), message: String(message || "") };
  if (rootId) body.root_id = String(rootId);
  const res = await proxiedFetch(`${root}/api/v4/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`mattermost post ${res.status}: ${errText.slice(0, 200)}`);
  }
  return res.json().catch(() => ({}));
}

/**
 * @param {{
 *   baseUrl: string,
 *   botToken: string,
 *   webhookPath?: string,
 *   port?: number,
 *   webhookToken?: string,
 *   onMessage: Function,
 *   logger?: { info?: Function, warn?: Function },
 * }} opts
 */
export function createMattermostAdapter({
  baseUrl,
  botToken,
  webhookPath = "/mattermost",
  port = 19000,
  webhookToken = "",
  onMessage,
  logger,
}) {
  let server;
  let state = "down";
  const pathNorm = normalizePath(webhookPath);

  return {
    name: "mattermost",
    state: () => state,
    detail: () => (server ? `http://127.0.0.1:${port}${pathNorm}` : undefined),
    async start() {
      server = createServer(async (req, res) => {
        try {
          const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
          if (req.method === "GET" && (url.pathname === "/health" || url.pathname === pathNorm)) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true, adapter: "mattermost" }));
            return;
          }
          if (req.method !== "POST" || url.pathname !== pathNorm) {
            res.writeHead(404);
            res.end("not found");
            return;
          }
          const raw = await readBody(req);
          const parsed = parseMattermostWebhook(raw, {
            contentType: req.headers["content-type"],
          });
          if (parsed.skip) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true, skip: parsed.skip }));
            return;
          }
          if (webhookToken && parsed.token && parsed.token !== webhookToken) {
            res.writeHead(401, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "bad webhook token" }));
            return;
          }
          const text = stripMattermostTrigger(parsed.text, parsed.triggerWord);
          // Ack quickly — Mattermost expects a fast webhook response.
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));

          await onMessage({
            platform: "mattermost",
            chatId: parsed.chatId,
            userId: parsed.userId,
            text,
            messageId: parsed.messageId,
            reply: async (msg) => {
              for (const chunk of segmentMattermostText(msg)) {
                await postMattermostMessage({
                  baseUrl,
                  botToken,
                  channelId: parsed.chatId,
                  message: chunk,
                  rootId: parsed.messageId,
                });
              }
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger?.warn?.(`dsh-wsl-im mattermost: ${msg}`);
          if (!res.headersSent) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: msg }));
          }
        }
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "0.0.0.0", resolve);
      });
      state = "up";
      logger?.info?.(
        `dsh-wsl-im mattermost webhook on 0.0.0.0:${port}${pathNorm} → ${String(baseUrl || "").replace(/\/$/, "")}`,
      );
    },
    stop() {
      state = "down";
      server?.close();
      server = undefined;
    },
  };
}

function normalizePath(p) {
  let s = String(p || "/mattermost").trim() || "/mattermost";
  if (!s.startsWith("/")) s = `/${s}`;
  return s.replace(/\/+$/, "") || "/mattermost";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
