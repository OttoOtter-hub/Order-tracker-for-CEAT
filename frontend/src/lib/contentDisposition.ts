// Pure (no React, no aliases): tested by npm test (node --test).

/**
 * The file name a download should be saved under, from its
 * Content-Disposition. RFC 5987's `filename*=UTF-8''…` (exact, any script)
 * wins over the plain `filename=`; the backend's older endpoints put a
 * percent-encoded name into the plain one, so that is decoded too.
 */
export function filenameFromDisposition(
  header: string | null | undefined,
  fallback: string
): string {
  if (!header) return fallback
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim())
    } catch {
      // malformed — fall through to the plain name
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(header)
  if (plain?.[1]) {
    try {
      return decodeURIComponent(plain[1])
    } catch {
      return plain[1]
    }
  }
  return fallback
}
