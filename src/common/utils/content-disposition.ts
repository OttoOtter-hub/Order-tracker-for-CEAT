/**
 * Content-Disposition for a download whose name may be any Unicode
 * (Cyrillic, spaces): an ASCII-only `filename` for old clients, and the
 * exact name in `filename*` (RFC 5987/6266: UTF-8, percent-encoded), which
 * every current browser — and our own downloadFile() — prefers.
 */
export function attachmentDisposition(fileName: string): string {
  const fallback =
    fileName
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_") || "download";
  // encodeURIComponent leaves ' ( ) * ! unescaped; RFC 5987's attr-char
  // doesn't allow ' ( ) *.
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
