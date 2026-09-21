/**
 * multer (via busboy) decodes the bytes of a multipart filename as latin1, but
 * browsers send them as UTF-8 — so "план.pdf" arrives as the mojibake
 * "Ð¿Ð»Ð°Ð½.pdf". Re-reading those characters as latin1 bytes and decoding them
 * as UTF-8 restores the name. A name that is plain ASCII, that already holds
 * characters beyond latin1 (it was decoded correctly), or whose bytes are not
 * valid UTF-8 is returned untouched.
 */
export function decodeMultipartFilename(name: string): string {
  let hasHighLatin1 = false;
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0xff) {
      return name;
    }
    if (code > 0x7f) {
      hasHighLatin1 = true;
    }
  }
  if (!hasHighLatin1) {
    return name;
  }
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes("�") ? name : decoded;
}
