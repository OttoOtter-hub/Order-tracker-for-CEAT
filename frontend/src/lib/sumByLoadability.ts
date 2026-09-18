// Mirrors the backend's sumByLoadabilityGroups
// (src/common/utils/sum-by-loadability.ts) — same "container-equivalent"
// formula (group by loadability, sum each group's raw quantity, divide once
// per group), reimplemented here because frontend and backend are separate
// npm projects with no shared runtime. Used for the live, pre-save
// recompute of priorityTotalContainers on PiDetailPage — the backend's own
// computePriorityAggregates is the source of truth once a value is saved.
export function sumByLoadabilityGroups(
  items: Array<{ value: number; loadability: number | null }>
): number {
  const byLoadability = new Map<number, number>()
  for (const { value, loadability } of items) {
    if (!loadability) {
      continue
    }
    byLoadability.set(loadability, (byLoadability.get(loadability) ?? 0) + value)
  }

  let total = 0
  for (const [loadability, sum] of byLoadability) {
    total += sum / loadability
  }
  return total
}
