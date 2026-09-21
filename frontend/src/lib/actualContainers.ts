import i18n from "@/i18n"
import { formatDay } from "@/lib/format"

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

// "Payment Receipt Status" arrives as whatever the cell held: usually a date
// (as "YYYY-MM-DD"), otherwise a word — show dates the way the rest of the
// app does and anything else as it is.
export function formatStatusValue(value: string | null): string {
  if (!value) {
    return "—"
  }
  return ISO_DAY.test(value) ? formatDay(value) : value
}

// Tooltip text for a date CEAT typed over the file's own.
export function overrideHint(sourceValue: string | null): string {
  return sourceValue
    ? i18n.t("shipped.overrideHint", { date: formatDay(sourceValue) })
    : i18n.t("shipped.overrideHintNoSource")
}

// Sum of the line quantities (numeric strings) for a totals row.
export function sumQuantities(quantities: string[]): number {
  return quantities.reduce((total, q) => total + Number(q), 0)
}
