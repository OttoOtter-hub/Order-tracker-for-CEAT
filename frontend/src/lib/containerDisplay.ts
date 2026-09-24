// Pure helpers (no React, no aliases): the frontend's `npm test` runs their
// tests straight through Node's own test runner.

// Phase 22: the "Move" dialog offers "OK to mix" first, above Container 1 —
// only there; the page's own card list keeps it last (the server's order).
export function moveTargetOrder<T extends { isOkToMix: boolean }>(
  containers: readonly T[]
): T[] {
  return [
    ...containers.filter((c) => c.isOkToMix),
    ...containers.filter((c) => !c.isOkToMix),
  ]
}

// "Контейнер 3" + "Ростов" -> "Контейнер 3: Ростов" — the same "label: name"
// shape as a PI number and its card name (formatPiTitle).
export function withContainerName(
  title: string,
  name: string | null | undefined
): string {
  const trimmed = name?.trim()
  return trimmed ? `${title}: ${trimmed}` : title
}
