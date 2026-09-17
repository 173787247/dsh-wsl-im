/**
 * WeCom aibot inbound media: download COS temp URL + AES-256-CBC decrypt
 * Independent rewrite of the official aibot decrypt (AES-256-CBC).
 * See docs/PROVENANCE.md.
 */

import { createDecipheriv } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { resolveWsProxyAgent } from "./proxy.js";

const AES_BLOCK = 16;
const AES_KEY_LEN = 32;
const MAX_PKCS7 = 32;
const MAX_BYTES = 50 * 1024 * 1024;

export function decryptWecomMedia(encrypted, aesKeyBase64) {
  if (!encrypted?.length) throw new Error("wecom media: empty ciphertext");
  if (!aesKeyBase64) throw new Error("wecom media: missing aeskey");
  let padded = String(aesKeyBase64).trim();
  const rem = padded.length % 4;
  if (rem) padded += "=".repeat(4 - rem);
  const key = Buffer.from(padded, "base64");
  if (key.length !== AES_KEY_LEN) {
    throw new Error(`wecom media: aeskey decoded length ${key.length}, want 32`);
  }
  const iv = key.subarray(0, AES_BLOCK);
  let data = Buffer.from(encrypted);
  const align = data.length % AES_BLOCK;
  if (align) {
    const paddedBuf = Buffer.alloc(data.length + (AES_BLOCK - align));
    data.copy(paddedBuf);
    data = paddedBuf;
  }
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return stripPkcs7(decrypted);
}

function stripPkcs7(buf) {
  if (!buf.length) throw new Error("wecom media: decrypt empty");
  const padLen = buf[buf.length - 1];
  if (padLen < 1 || padLen > MAX_PKCS7 || padLen > buf.length) {
    throw new Error(`wecom media: bad PKCS#7 pad ${padLen}`);
  }
  for (let i = buf.length - padLen; i < buf.length; i++) {
    if (buf[i] !== padLen) throw new Error("wecom media: PKCS#7 mismatch");
  }
  return buf.subarray(0, buf.length - padLen);
}

export function sniffImageMediaType(buf) {
  if (!buf || buf.length < 12) return undefined;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

function httpGet(url, { agent, timeoutMs, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error("wecom media: too many redirects"));
      return;
    }
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(url, { agent, timeout: timeoutMs }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        resolve(httpGet(next, { agent, timeoutMs, redirects: redirects + 1 }));
        return;
      }
      if (code < 200 || code >= 300) {
        res.resume();
        reject(new Error(`wecom media download HTTP ${code}`));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > MAX_BYTES) {
          req.destroy();
          reject(new Error("wecom media: too large"));
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
      reject(new Error("wecom media: download timeout"));
    });
  });
}

export async function downloadWecomBytes(url, { timeoutMs = 60_000 } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) throw new Error("wecom media: bad url");
  const agent = resolveWsProxyAgent();
  return httpGet(url, { agent, timeoutMs });
}

/** Download (+ decrypt) WeCom image payload → { data, mediaType }. */
export async function resolveWecomImage(image) {
  const url = image?.url;
  const aeskey = image?.aeskey || image?.aes_key;
  if (!url) throw new Error("wecom image: missing url");
  let bytes = await downloadWecomBytes(url);
  if (aeskey) bytes = decryptWecomMedia(bytes, aeskey);
  const mediaType = sniffImageMediaType(bytes);
  if (!mediaType) throw new Error("wecom image: unrecognized after decrypt");
  return { data: new Uint8Array(bytes), mediaType };
}

/** Download (+ decrypt) WeCom file payload → { data, name }. */
export async function resolveWecomFile(file) {
  const url = file?.url;
  const aeskey = file?.aeskey || file?.aes_key;
  const rawName =
    String(file?.file_name || file?.filename || file?.name || "wecom-file").trim() || "wecom-file";
  if (!url) throw new Error("wecom file: missing url");
  let bytes = await downloadWecomBytes(url);
  if (aeskey) bytes = decryptWecomMedia(bytes, aeskey);
  if (!bytes?.length) throw new Error("wecom file: empty after download");
  const { ensureFileExtension } = await import("./filename.js");
  const name = ensureFileExtension(sanitizeFileName(rawName), bytes);
  return { data: new Uint8Array(bytes), name };
}

/** Download (+ decrypt) WeCom video payload → { data, name } (same COS+AES as file). */
export async function resolveWecomVideo(video) {
  const url = video?.url;
  const aeskey = video?.aeskey || video?.aes_key;
  const rawName =
    String(video?.file_name || video?.filename || video?.name || "wecom-video").trim() ||
    "wecom-video";
  if (!url) throw new Error("wecom video: missing url");
  let bytes = await downloadWecomBytes(url);
  if (aeskey) bytes = decryptWecomMedia(bytes, aeskey);
  if (!bytes?.length) throw new Error("wecom video: empty after download");
  const { ensureFileExtension } = await import("./filename.js");
  let name = ensureFileExtension(sanitizeFileName(rawName), bytes);
  if (!/\.[A-Za-z0-9]{1,8}$/.test(name)) name = `${name}.mp4`;
  return { data: new Uint8Array(bytes), name };
}

/** Download (+ decrypt) WeCom voice when platform ASR is empty. */
export async function resolveWecomVoice(voice) {
  const url = voice?.url;
  const aeskey = voice?.aeskey || voice?.aes_key;
  if (!url) throw new Error("wecom voice: missing url");
  let bytes = await downloadWecomBytes(url);
  if (aeskey) bytes = decryptWecomMedia(bytes, aeskey);
  if (!bytes?.length) throw new Error("wecom voice: empty after download");
  const { ensureFileExtension, sniffFileExtension } = await import("./filename.js");
  let name = ensureFileExtension("wecom-voice", bytes);
  if (!sniffFileExtension(bytes)) name = "wecom-voice.silk";
  return { data: new Uint8Array(bytes), name };
}

function sanitizeFileName(name) {
  const base = String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  return base.slice(0, 180) || "wecom-file";
}
