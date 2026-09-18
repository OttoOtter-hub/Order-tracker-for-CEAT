/** numeric columns round-trip through the app as strings (see pg driver
 * notes elsewhere) — this converts one back to a real number for writing
 * into an xlsx numeric cell, or null if there's nothing to write. */
export function toNumberOrNull(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}
