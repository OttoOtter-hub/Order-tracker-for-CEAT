export interface StatusStyle {
  // i18n key of the badge text; null for an unknown status, which is shown raw.
  labelKey: string | null
  className: string
}

// Full literal class strings (not built via template interpolation) so
// Tailwind's static scanner can find them — dynamic `bg-${color}-500/10`
// strings are invisible to it and silently produce no CSS.
const GRAY = "bg-gray-500/10 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400"
const BLUE = "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400"
const AMBER = "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
const GREEN = "bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400"
const PURPLE = "bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400"

export const PI_STATUS: Record<string, StatusStyle> = {
  missing_pi_document: { labelKey: "piStatus.missing_pi_document", className: GRAY },
  missing_signed_document: {
    labelKey: "piStatus.missing_signed_document",
    className: AMBER,
  },
  signed: { labelKey: "piStatus.signed", className: GREEN },
  replacement_pending: { labelKey: "piStatus.replacement_pending", className: BLUE },
  archived_shipped: { labelKey: "piStatus.archived_shipped", className: PURPLE },
}

export function statusStyle(
  map: Record<string, StatusStyle>,
  status: string
): StatusStyle {
  return map[status] ?? { labelKey: null, className: GRAY }
}
