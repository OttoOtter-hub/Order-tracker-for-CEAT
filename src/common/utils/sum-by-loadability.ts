/**
 * Shared "container-equivalent" formula: group items by loadability
 * (units per container), sum each group's raw quantity first, then divide
 * once per group — not per row with the already-divided ratios summed
 * afterwards (those aren't equal when multiple rows share a loadability).
 * A missing or zero loadability contributes 0, not NaN/Infinity.
 *
 * Used by computePiAggregates (backorder upload, ParsedBackorderRow input)
 * and computePriorityAggregates (live PiLineItem read, priorityQty input) —
 * same math, different callers, so it lives here instead of being copied
 * into each.
 */
export function sumByLoadabilityGroups(
  items: Array<{ value: number; loadability: number | null | undefined }>,
): number {
  const byLoadability = new Map<number, number>();
  for (const { value, loadability } of items) {
    if (!loadability) {
      continue;
    }
    byLoadability.set(loadability, (byLoadability.get(loadability) ?? 0) + value);
  }

  let total = 0;
  for (const [loadability, sum] of byLoadability) {
    total += sum / loadability;
  }
  return total;
}
