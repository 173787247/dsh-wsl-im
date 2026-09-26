/**
 * Optional local Whisper ASR for IM voice when platform ASR is empty.
 * Does not depend on dsh-wsl-media package.
 */

import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

const AUDIO_EXT = new Set([".wav", ".mp3", ".m4a", ".ogg", ".flac", ".webm"]);

export function which(cmd) {
  const safe = String(cmd || "").replace(/[^a-zA-Z0-9._+-]/g, "");
  if (!safe) return Promise.resolve("");
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", `command -v ${safe}`], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", (c) => resolve(c === 0 ? out.trim() : ""));
  });
}

function runCmd(bin, args, { timeoutMs = 120_000, maxOut = 2_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("asr timeout"));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout = Buffer.concat([stdout, d]);
      if (stdout.length > maxOut) child.kill("SIGKILL");
    });
    child.stderr.on("data", (d) => {
      stderr = Buffer.concat([stderr, d]);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8").slice(0, 2000),
      });
    });
  });
}

/**
 * @param {string} filePath absolute path already on disk
 * @param {{ enabled?: boolean, timeoutMs?: number, language?: string }} [opts]
 * @returns {Promise<{ ok: boolean, text?: string, error?: string, engine?: string }>}
 */
export async function localAsrTranscribe(filePath, opts = {}) {
  if (opts.enabled === false) {
    return { ok: false, error: "voiceAsr disabled" };
  }
  const file = String(filePath || "").trim();
  if (!file || !existsSync(file)) {
    return { ok: false, error: "audio file missing" };
  }

  let work = file;
  let tmpWav = "";
  const ext = extname(file).toLowerCase();
  try {
    if (!AUDIO_EXT.has(ext)) {
      const ffmpeg = (await which("ffmpeg")) || "ffmpeg";
      tmpWav = join(tmpdir(), `dsh-im-asr-${basename(file, ext)}-${Date.now()}.wav`);
      const conv = await runCmd(
        ffmpeg,
        ["-y", "-i", file, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", tmpWav],
        { timeoutMs: Math.min(opts.timeoutMs || 120_000, 120_000) },
      );
      if (conv.code !== 0 || !existsSync(tmpWav)) {
        return {
          ok: false,
          error: `ffmpeg convert failed (${ext || "unknown"}): ${(conv.stderr || "").slice(0, 200)}`,
        };
      }
      work = tmpWav;
    }

    let bin = await which("whisper");
    let args;
    let engine;
    if (bin) {
      engine = "whisper";
      args = [work, "--output_format", "txt", "--output_dir", tmpdir()];
      if (opts.language) args.push("--language", String(opts.language));
    } else {
      bin = (await which("whisper-cpp")) || (await which("whisper.cpp"));
      if (!bin) return { ok: false, error: "no whisper / whisper-cpp on PATH" };
      engine = "whisper-cpp";
      args = ["-f", work];
      if (opts.language) args.push("-l", String(opts.language));
    }

    const { code, stdout, stderr } = await runCmd(bin, args, {
      timeoutMs: opts.timeoutMs || 300_000,
      maxOut: 5_000_000,
    });
    if (code !== 0) {
      return { ok: false, error: `asr failed: ${(stderr || String(code)).slice(0, 300)}`, engine };
    }
    const text = String(stdout || "").trim();
    if (!text) return { ok: false, error: "asr empty output", engine };
    return { ok: true, text, engine };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (tmpWav) {
      try {
        unlinkSync(tmpWav);
      } catch {
        /* ignore */
      }
    }
  }
}

export function isProbablyAudioName(name) {
  const n = String(name || "").toLowerCase();
  return (
    AUDIO_EXT.has(extname(n)) ||
    n.endsWith(".silk") ||
    n.endsWith(".slk") ||
    n.includes("voice") ||
    n.includes("audio")
  );
}

export const NO_ASR_HINT =
  "这条语音没有可用转写（平台 ASR 为空，本机 Whisper 也不可用）。请改发文字。";
