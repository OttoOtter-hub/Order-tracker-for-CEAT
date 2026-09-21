import { useTranslation } from "react-i18next"
import type { UnallocatedLine } from "@/api/readyToShip"

// The backend rejects a move for a line with no usable loadability (its fill
// can't be computed), so the UI never offers one: the row is marked and its
// button disabled instead of letting the client hit the error in the dialog.
export function isPlaceable(line: UnallocatedLine): boolean {
  return line.loadability !== null && line.loadability > 0
}

// The slot labels are stored as "Контейнер N" (the backend's own wording, left
// untouched in the database). The number is what matters, so the screen builds
// the name itself in the current language; a label that is not of that form
// (a custom one) is shown as it is. Same extraction as the Excel export's
// containerCell() on the backend.
const CONTAINER_LABEL = /^\s*(?:Контейнер|Container)\s+(\d+)\s*$/i

export function containerNumberOf(label: string): number | null {
  const match = CONTAINER_LABEL.exec(label)
  return match ? Number(match[1]) : null
}

// Re-renders with the language, like any other useTranslation() consumer.
export function useContainerName(): (label: string) => string {
  const { t } = useTranslation()
  return (label) => {
    const n = containerNumberOf(label)
    return n === null ? label : t("readyToShip.containerLabel", { n })
  }
}
