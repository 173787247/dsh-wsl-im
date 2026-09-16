/**
 * Infer a display filename from platform name + magic bytes.
 */

export function sniffFileExtension(buf) {
  if (!buf || buf.length < 8) return undefined;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return ".pdf"; // %PDF
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07))
    return ".zip"; // PK
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return ".doc"; // OLE
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ".jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ".png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ".gif";
  // ISO BMFF (mp4/mov/m4a…): ....ftyp
  if (b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70)
    return ".mp4";
  // UTF-8 / UTF-16 BOM → text
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return ".txt";
  if (b[0] === 0xff && b[1] === 0xfe) return ".txt";
  return undefined;
}

export function ensureFileExtension(name, data) {
  const base = String(name || "wecom-file").trim() || "wecom-file";
  if (/\.[A-Za-z0-9]{1,8}$/.test(base)) return base;
  const ext = sniffFileExtension(data);
  return ext ? `${base}${ext}` : base;
}
