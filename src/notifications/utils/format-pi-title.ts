/** Mirrors frontend/src/lib/format.ts's formatPiTitle — same "{number}: {label}" convention. */
export function formatPiTitle(
  piNumber: string,
  label: string | null | undefined,
): string {
  const trimmed = label?.trim();
  return trimmed ? `${piNumber}: ${trimmed}` : piNumber;
}
