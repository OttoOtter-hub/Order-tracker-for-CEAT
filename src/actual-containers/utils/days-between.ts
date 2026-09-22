const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Both are "YYYY-MM-DD" (or a full ISO string for "today"); UTC-midnight math, no timezone drift. */
export function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  const from = Date.parse(fromIsoDate);
  const to = Date.parse(toIsoDate.slice(0, 10));
  return Math.round((to - from) / MS_PER_DAY);
}
