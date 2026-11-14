/**
 * TTS for outbound IM replies.
 *
 * Why local Piper and not a cloud API:
 *   edge-tts (the only cloud TTS on this machine) cannot reach
 *   speech.platform.bing.com from here, and a poster session happens
 *   on a conference network nobody controls. Piper is offline.
 *
 * Language routing:
 *   zh -> Windows SAPI (Huihui), because the Piper zh_CN models are weak
 *   en/fr/de/es/it -> Piper voice models under ~/.local/share/piper-voices
 *
 * The caller gets a WAV path or ok:false; it decides whether silence is
 * acceptable.
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const exec = promisify(execFile);

const PIPER = path.join(os.homedir(), ".venvs/easel/bin/piper");
const MDL_DIR = path.join(os.homedir(), ".local/share/piper-voices");

const MODELS = {
  en: "en_US-lessac-medium",
  fr: "fr_FR-siwis-medium",
  de: "de_DE-thorsten-medium",
  es: "es_ES-davefx-medium",
  it: "it_IT-riccardo-x_low",
};

// Strongest-signal word lists; intentionally small. A wrong guess costs a
// slightly odd accent, not a wrong answer, so recall beats precision here.
const FEATURES = {
  // 只收「这个语言特有、别的语言少见」的词。
  // 之前把 "en" / "est" / "con" 放进法语/西语，导致
  // "Pouvez-vous expliquer votre étude" 被误判成西语。
  fr: [" le ", " les ", " des ", " une ", " est ", " et ", " pour ", " dans ",
       " avec ", " nous ", " vous ", " votre ", " que ", " qui ", " sur ",
       " du ", " au ", " ce ", " c'est ", " n'est ", " pouvez ", " étude ",
       " termes ", " aussi ", " mais ", " plus ", " faut ", " être "],
  de: [" der ", " die ", " das ", " und ", " nicht ", " ist ", " mit ", " für ",
       " auf ", " ein ", " eine ", " sie ", " wir ", " ich ", " den ", " dem ",
       " zu ", " auch ", " aber ", " nur ", " kann ", " wird ", " sind "],
  es: [" los ", " las ", " una ", " para ", " por ", " del ", " se ", " su ",
       " al ", " como ", " pero ", " más ", " puede ", " está ", " son ",
       " este ", " esta ", " entre ", " desde ", " hasta ", " según ",
       " tasa ", " capa ", " tiempo ", " éxito ", " resultado ", " estudio ",
       " artículo ", " nuestro ", " nuestra ", " trabajo ", " gracias ",
       " hemos ", " medido ", " coste ", " pila ", " ubicación ", " hemos ",
       " pero ", " cuando ", " donde ", " todos ", " todas ", " sin "],
  it: [" gli ", " della ", " che ", " per ", " con ", " sono ", " questo ",
       " una ", " del ", " nel ", " alla ", " dei ", " anche ", " ma ",
       " più ", " può ", " essere ", " come ", " tra ", " fra ",
       " tasso ", " successo ", " livello ", " studio ", " spiegare ",
       " articolo ", " risultato ", " nostro ", " nostra ", " grazie ",
       " il ", " lo ", " di ", " è ", " non "],
};

// 重音字符是很强的信号
const ACCENTS = [
  [/[àâçèêëîïôùûÿœæ]/gi, "fr"],   // é 被拿掉，因为西语也常用
  [/[äöüß]/gi, "de"],
  [/[ñ¿¡]/gi, "es"],
];

/** Best-effort language guess from the text being spoken. */
export function detectLang(text) {
  const t = String(text || "");
  if (/[\u4e00-\u9fff]/.test(t)) return "zh";

  // 重音字符先给一个强投票（每种 +3），但最终还是词频说了算
  const accentBoost = {};
  for (const [re, lang] of ACCENTS) {
    const n = (t.match(re) || []).length;
    if (n) accentBoost[lang] = (accentBoost[lang] || 0) + n * 3;
  }

  const lc = ` ${t.toLowerCase()} `;
  let best = "en";
  let bestScore = 0;
  for (const [lang, words] of Object.entries(FEATURES)) {
    let s = accentBoost[lang] || 0;
    for (const w of words) {
      if (lc.includes(w)) s += 1;
    }
    if (s > bestScore) {
      bestScore = s;
      best = lang;
    }
  }
  // 一个特征词都没有、也没有重音 —— 当英文处理
  return bestScore > 0 ? best : "en";
}

/** Strip markdown so the voice does not read asterisks and hashes aloud. */
export function speakable(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")          // fenced blocks
    .replace(/`([^`]+)`/g, "$1")               // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")     // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")   // links -> label
    .replace(/^#{1,6}\s*/gm, "")               // headings
    .replace(/^\s*[-*+]\s+/gm, "")             // bullets
    .replace(/^\s*\d+\.\s+/gm, "")             // numbered lists
    .replace(/[*_~]{1,3}/g, "")                // emphasis markers
    .replace(/\s+/g, " ")
    .trim();
}

async function fileExists(p) {
  try {
    const st = await fs.stat(p);
    return st.size > 1_000_000; // a real medium model is tens of MB
  } catch {
    return false;
  }
}

/**
 * Synthesize `text` to a WAV file. Returns { ok, path, lang, engine, error? }.
 * `lang` may be "auto" (default), a concrete code, or "off".
 */
export async function synthesize(text, opts = {}) {
  const clean = speakable(text);
  if (!clean) return { ok: false, error: "empty text after stripping markdown" };
  // Keep replies under the QQ voice length that we verified (about 60 s).
  const clipped = clean.length > 900 ? `${clean.slice(0, 900)}…` : clean;

  const lang = opts.lang && opts.lang !== "auto" ? opts.lang : detectLang(clipped);
  const outPath = path.join(
    os.tmpdir(),
    `im-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
  );

  if (lang === "zh") {
    return sapi(clipped, outPath, "Microsoft Huihui Desktop");
  }
  if (lang === "en") {
    return sapi(clipped, outPath, "Microsoft Zira Desktop");
  }

  const model = MODELS[lang];
  if (!model) return { ok: false, error: `no voice for language ${lang}` };
  const onnx = path.join(MDL_DIR, `${model}.onnx`);
  if (!(await fileExists(onnx))) {
    return { ok: false, error: `voice model missing: ${onnx}` };
  }

  try {
    // execFile 不支持 input 选项 —— 必须用 spawn 把文本写进 stdin。
    // （之前用 execFile 传 input，piper 拿不到文本，一跑就失败。）
    await new Promise((resolve, reject) => {
      const child = spawn(PIPER, ["--model", onnx, "--output_file", outPath], {
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`piper timed out after ${opts.timeoutMs ?? 60_000}ms`));
      }, opts.timeoutMs ?? 60_000);

      child.stderr.on("data", (b) => {
        stderr += String(b);
        if (stderr.length > 4000) stderr = stderr.slice(-4000);
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`piper exited ${code}: ${stderr.trim().slice(-500)}`));
      });
      child.stdin.end(clipped, "utf8");
    });
    const st = await fs.stat(outPath);
    if (!st.size) return { ok: false, error: "piper produced an empty file" };
    return { ok: true, path: outPath, lang, engine: "piper", bytes: st.size };
  } catch (e) {
    return { ok: false, error: `piper failed: ${e?.message || e}` };
  }
}

/**
 * Windows SAPI path.
 *
 * English goes here too: the Piper en_US model does not survive download on
 * this link (three attempts, 13–60 MB, protobuf-invalid every time), while
 * Zira is installed, offline, and already verified end-to-end through QQ.
 */
async function sapi(text, outPath, voice) {
  const safe = text.replace(/'/g, "''");
  // Let PowerShell resolve its own temp directory and report the WSL path back;
  // process.env.USERNAME is not the Windows account name under WSL.
  const stamp = `${Date.now()}`;
  const ps = [
    "Add-Type -AssemblyName System.Speech",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    `$s.SelectVoice('${voice}')`,
    `$w = Join-Path $env:TEMP 'im-tts-${stamp}.wav'`,
    "$s.SetOutputToWaveFile($w)",
    `$s.Speak('${safe}')`,
    "$s.Dispose()",
    "Write-Output $w",
  ].join("; ");
  try {
    const { stdout } = await exec("powershell.exe", ["-NoProfile", "-Command", ps], {
      timeout: 60_000,
    });
    const winPath = String(stdout || "").trim();
    if (!winPath) throw new Error("powershell returned no path");
    const winAsWsl = winPath.replace(/^C:/i, "/mnt/c").replace(/\\/g, "/");
    const buf = await fs.readFile(winAsWsl);
    await fs.writeFile(outPath, buf);
    await fs.unlink(winAsWsl).catch(() => {});
    return { ok: true, path: outPath, lang: voice.includes("Huihui") ? "zh" : "en", engine: "sapi", bytes: buf.length };
  } catch (e) {
    return { ok: false, error: `sapi failed: ${e?.message || e}` };
  }
}

/** Remove a synthesized clip once it has been uploaded. */
export async function cleanup(p) {
  if (!p) return;
  await fs.unlink(p).catch(() => {});
}
