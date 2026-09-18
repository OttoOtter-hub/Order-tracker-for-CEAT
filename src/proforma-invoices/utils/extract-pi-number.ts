/**
 * PI numbers in this pilot are always 6+ consecutive digits (e.g.
 * "100037320"). Matching the first such run anywhere in the filename finds
 * the number regardless of prefixes like "signed_" or a shorter date/version
 * fragment before it (a 4-digit year won't match, so "invoice_2024_100037320.pdf"
 * still resolves to "100037320").
 */
const PI_NUMBER_PATTERN = /\d{6,}/;

export function extractPiNumber(filename: string): string | null {
  const match = PI_NUMBER_PATTERN.exec(filename);
  return match ? match[0] : null;
}
