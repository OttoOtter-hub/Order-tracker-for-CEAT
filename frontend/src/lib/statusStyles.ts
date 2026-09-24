export interface StatusStyle {
  // i18n key of the badge text; null for an unknown status, which is shown raw.
  labelKey: string | null
  className: string
}

// Full literal class strings (not built via template interpolation) so
// Tailwind's static scanner can find them — dynamic `bg-${color}-500/10`
// strings are invisible to it and silently produce no CSS.
const GRAY = "bg-idle/10 text-idle-text dark:bg-idle/20"
const BLUE = "bg-info/10 text-info-text dark:bg-info/20"
const AMBER = "bg-warning/10 text-warning-text dark:bg-warning/20"
const GREEN = "bg-success/10 text-success-text dark:bg-success/20"
const PURPLE = "bg-archived/10 text-archived-text dark:bg-archived/20"

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
