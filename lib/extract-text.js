/**
 * Best-effort local text extraction for common office/docs (PDF via pdftotext).
 * Returns undefined when unavailable — agent tools remain the primary path.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sniffFileExtension } from "./filename.js";

const MAX_EXTRACT_CHARS = 80_000;

export function extractLocalText(data, name) {
  const ext = sniffFileExtension(data) || (name && name.match(/(\.[A-Za-z0-9]+)$/)?.[1]) || "";
  if (ext.toLowerCase() === ".pdf") return extractPdf(data);
  return undefined;
}

function extractPdf(data) {
  const dir = mkdtempSync(join(tmpdir(), "dsh-wsl-im-pdf-"));
  const pdfPath = join(dir, "in.pdf");
  const txtPath = join(dir, "out.txt");
  try {
    writeFileSync(pdfPath, Buffer.from(data));
    const r = spawnSync(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", pdfPath, txtPath],
      { encoding: "utf8", timeout: 60_000 },
    );
    if (r.status !== 0) {
      console.warn(`[dsh-wsl-im] pdftotext failed: ${r.stderr || r.error || r.status}`);
      return undefined;
    }
    let text = readFileSync(txtPath, "utf8").trim();
    if (!text) return undefined;
    if (text.length > MAX_EXTRACT_CHARS) {
      text = `${text.slice(0, MAX_EXTRACT_CHARS)}\n\n…(truncated)`;
    }
    return text;
  } catch (e) {
    console.warn(`[dsh-wsl-im] pdf extract error: ${e?.message || e}`);
    return undefined;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
