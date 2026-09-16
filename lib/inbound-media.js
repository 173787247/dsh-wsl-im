/**
 * Shared inbound media classification for Feishu / DingTalk / QQ.
 * Images go to bridge `images`; everything else is a workspace file (PDF extract, no ffmpeg/whisper).
 */

import { ensureFileExtension, sniffFileExtension } from "./filename.js";
import { sniffImageMediaType } from "./wecom-media.js";

export function mediaUserText({ kind, name }) {
  if (kind === "image") return "请查看这张图片并简要描述内容。";
  if (kind === "audio") {
    return (
      `用户发来语音，平台转写为空，音频已落到工作区「${name}」。` +
      "本机没有 Whisper，无法再转写。请用户改发文字。"
    );
  }
  if (kind === "video") {
    return (
      `用户发来视频附件「${name}」。` +
      "当前不会自动理解画面或抽音轨转写；请确认已落盘到工作区 inbox，并请用户补充文字说明或改发截图/文字。"
    );
  }
  return `请阅读附件「${name}」并总结要点。`;
}

export function asrText(raw) {
  const asr = String(raw || "").trim();
  return asr ? `[语音转写] ${asr}` : "";
}

export function hostAllowed(url, suffixes) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return suffixes.some((s) => host === s.replace(/^\./, "") || host.endsWith(s));
}

export const QQ_MEDIA_HOSTS = [".qq.com", ".qq.com.cn", ".myqcloud.com", ".ugcimg.cn"];
export const DING_MEDIA_HOSTS = [".dingtalk.com", ".alicdn.com", ".aliyuncs.com"];

export function sanitizeFileName(name, fallback) {
  const base = String(name || fallback || "im-file")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .trim();
  return (base || fallback || "im-file").slice(0, 180);
}

/**
 * Turn downloaded bytes into a bridge image or file.
 * @returns {{ image?: { data: Uint8Array, mediaType: string }, file?: { data: Uint8Array, name: string }, name: string }}
 */
export function toBridgePart({ kind, name, data, fallbackName }) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  if (!bytes.length) throw new Error("media: empty download");
  const safe = sanitizeFileName(name, fallbackName || "im-file");
  if (kind === "image") {
    const mediaType = sniffImageMediaType(bytes);
    if (mediaType) {
      return { image: { data: new Uint8Array(bytes), mediaType }, name: safe };
    }
  }
  let finalName = ensureFileExtension(safe, bytes);
  if (kind === "video" && !/\.[A-Za-z0-9]{1,8}$/.test(finalName)) finalName = `${finalName}.mp4`;
  if (kind === "audio" && !sniffFileExtension(bytes) && !/\.[A-Za-z0-9]{1,8}$/.test(finalName)) {
    finalName = `${finalName}.silk`;
  }
  return { file: { data: new Uint8Array(bytes), name: finalName }, name: finalName };
}
