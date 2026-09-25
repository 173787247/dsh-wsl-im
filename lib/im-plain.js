/**
 * Flatten Markdown into IM-friendly plain text.
 * QQ / DingTalk text / Telegram do not render GFM tables or most Markdown.
 */

/** Platforms that should receive plain text, not raw Markdown. */
export const PLAIN_TEXT_PLATFORMS = new Set(["qq", "dingtalk", "telegram"]);

/**
 * @param {string} text
 * @param {{ platform?: string }} [opts]
 * @returns {string}
 */
export function formatImOutbound(text, opts = {}) {
  const platform = String(opts.platform || "").toLowerCase();
  if (platform && !PLAIN_TEXT_PLATFORMS.has(platform)) return String(text || "");
  return toImPlainText(text);
}

/**
 * @param {string} text
 * @returns {string}
 */
export function toImPlainText(text) {
  let s = String(text || "").replace(/\r\n/g, "\n");
  if (!s.trim()) return s;

  s = flattenCodeFences(s);
  s = flattenTables(s);
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/^>\s?/gm, "");
  s = s.replace(/^(\s*)[-*+]\s+/gm, "$1• ");
  s = s.replace(/^(\s*)\d+\.\s+/gm, "$1");
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const L = String(label || "").trim();
    const U = String(url || "").trim();
    if (!L) return U;
    if (!U || L === U) return L;
    return `${L}（${U}）`;
  });
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1");
  s = s.replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1");
  s = s.replace(/~~([^~]+)~~/g, "$1");
  s = s.replace(/^\s*([-*_]{3,})\s*$/gm, "");
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function flattenCodeFences(text) {
  return text.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, body) => {
    const inner = String(body || "").replace(/\n+$/g, "").replace(/^\n+/g, "");
    if (!inner) return "";
    return `\n${inner}\n`;
  });
}

function isTableSep(line) {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*\|?\s*$/.test(line) && /---/.test(line);
}

function isTableRow(line) {
  const t = line.trim();
  return t.startsWith("|") && t.includes("|", 1);
}

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

function flattenTables(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!isTableRow(lines[i])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const block = [];
    while (i < lines.length && (isTableRow(lines[i]) || isTableSep(lines[i]))) {
      block.push(lines[i]);
      i += 1;
    }
    const rendered = renderTableBlock(block);
    if (rendered) out.push(rendered);
    else out.push(...block);
  }
  return out.join("\n");
}

function renderTableBlock(block) {
  const rows = block.filter((ln) => isTableRow(ln) && !isTableSep(ln)).map(splitRow);
  if (rows.length === 0) return "";
  const headers = rows[0];
  const data = rows.slice(1);
  if (data.length === 0) {
    return headers.filter(Boolean).map((h) => `• ${h}`).join("\n");
  }
  const keyFirst = isKeyValueTable(headers);
  const lines = [];
  for (const cells of data) {
    if (keyFirst) {
      const key = String(cells[0] ?? "").trim();
      const status = String(cells[1] ?? "").trim();
      const rest = cells
        .slice(2)
        .map((c) => String(c ?? "").trim())
        .filter(Boolean);
      if (!key && !status && rest.length === 0) continue;
      let line = key ? `• ${key}` : "•";
      if (status) line += `：${status}`;
      if (rest.length) line += ` — ${rest.join("；")}`;
      lines.push(line);
      continue;
    }
    const parts = [];
    for (let c = 0; c < Math.max(headers.length, cells.length); c += 1) {
      const h = headers[c] || `列${c + 1}`;
      const v = cells[c] ?? "";
      if (!String(h).trim() && !String(v).trim()) continue;
      parts.push(`${h}：${v}`);
    }
    if (parts.length === 1) lines.push(`• ${parts[0]}`);
    else if (parts.length > 1) lines.push(`• ${parts.join("；")}`);
  }
  return lines.join("\n");
}

/** Tables whose first column is a label (项/名称/…) read better as key：value. */
function isKeyValueTable(headers) {
  if (!headers || headers.length < 2) return false;
  const h0 = String(headers[0] || "")
    .trim()
    .toLowerCase();
  return /^(项|项目|名称|名字|模块|组件|渠道|平台|item|name|key|模块名)$/i.test(h0);
}
