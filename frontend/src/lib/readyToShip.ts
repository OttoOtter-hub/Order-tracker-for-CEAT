import { useTranslation } from "react-i18next"
import type { UnallocatedLine } from "@/api/readyToShip"
import { withContainerName } from "@/lib/containerDisplay"

// A line with no usable loadability has no computable fill, so the backend
// only lets it into "OK to mix" (Phase 21): the row is marked, and in the
// move dialog every numbered container is disabled for it.
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

// Phase 22: the name as shown everywhere a container is picked or listed —
// "Container 3: Ростов" once the client has named it, else just the label.
export function useContainerTitle(): (container: {
  label: string
  name?: string | null
}) => string {
  const containerName = useContainerName()
  return (container) =>
    withContainerName(containerName(container.label), container.name)
}
