// Pure (no React), tested by npm test (node --test).

/**
 * "37%" / "<1%" / "—": the API's remainingPercent (one decimal, a remainder is
 * at least 0.1, null = nothing to measure) as the screen shows it. Whole
 * percent; anything below 1 is "<1%", and a card with something left is
 * never rounded up to "100%".
 */
export function formatRemainingPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  if (value > 0 && value < 1) return "<1%"
  const whole = Math.round(value)
  return `${value < 100 ? Math.min(whole, 99) : whole}%`
}
