/**
 * HTTP helpers for Feishu / DingTalk / QQ media.
 * This WSL has no direct egress; when HTTPS_PROXY is set, use the same agent as WeCom.
 */

import http from "node:http";
import https from "node:https";
import { resolveWsProxyAgent } from "./proxy.js";

export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

export function downloadBytes(
  url,
  { headers = {}, timeoutMs = 60_000, maxBytes = MAX_MEDIA_BYTES, allow } = {},
) {
  if (!url || !/^https:\/\//i.test(url)) {
    return Promise.reject(new Error("media download: url must be https"));
  }
  if (allow && !allow(url)) {
    return Promise.reject(new Error("media download: host not allowed"));
  }
  return httpGet(url, { headers, timeoutMs, maxBytes, redirects: 0, allow });
}

function httpGet(url, { headers, timeoutMs, maxBytes, redirects, allow }) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error("media download: too many redirects"));
      return;
    }
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(url, { headers, timeout: timeoutMs, agent: resolveWsProxyAgent() }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        if (allow && !allow(next)) {
          reject(new Error("media download: redirect host not allowed"));
          return;
        }
        resolve(httpGet(next, { headers, timeoutMs, maxBytes, redirects: redirects + 1, allow }));
        return;
      }
      if (code < 200 || code >= 300) {
        res.resume();
        reject(new Error(`media download HTTP ${code}`));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > maxBytes) {
          req.destroy();
          reject(new Error("media download: too large"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("media download: timeout"));
    });
  });
}

export function postJson(url, body, { headers = {}, timeoutMs = 20_000 } = {}) {
  if (!url || !/^https:\/\//i.test(url)) {
    return Promise.reject(new Error("postJson: url must be https"));
  }
  const payload = Buffer.from(JSON.stringify(body ?? {}));
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        agent: resolveWsProxyAgent(),
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(payload.length),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const code = res.statusCode || 0;
          if (code < 200 || code >= 300) {
            reject(new Error(`POST ${new URL(url).pathname} HTTP ${code}`));
            return;
          }
          try {
            resolve(text ? JSON.parse(text) : {});
          } catch {
            reject(new Error(`POST ${new URL(url).pathname}: bad JSON`));
          }
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("postJson: timeout"));
    });
    req.end(payload);
  });
}

export function readLimitedStream(stream, maxBytes = MAX_MEDIA_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    stream.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        stream.destroy?.();
        reject(new Error("media download: too large"));
        return;
      }
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
