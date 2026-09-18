/**
 * YYYY-MM-DD, UTC-based (not server-local time) so the same instant always
 * produces the same date string regardless of which machine runs this —
 * matches the frontend's own todayIsoDate() convention.
 */
export function formatDateForFilename(date: Date): string {
  return date.toISOString().slice(0, 10);
}
