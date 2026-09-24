import { numberLocale } from "@/i18n"

// How full a container is, as the client sees it. The thresholds are the
// spec's: up to 90% is unremarkable, 90-100% is yellow ("nearly full"), and
// anything above 100% is red — that is also exactly what blocks "Подтвердить"
// on the backend (Σ qty/loadability > 1).
export type FillLevel = "ok" | "warn" | "over"

export function fillLevel(percent: number): FillLevel {
  if (percent > 100) return "over"
  if (percent > 90) return "warn"
  return "ok"
}

// Full literal class strings, not built by interpolation — Tailwind's static
// scanner can't see `text-${color}` and would silently emit no CSS (same
// reason as statusStyles.ts).
export const FILL_TEXT: Record<FillLevel, string> = {
  ok: "text-foreground",
  warn: "text-warning-text",
  over: "text-destructive",
}

export const FILL_BAR: Record<FillLevel, string> = {
  ok: "bg-info",
  warn: "bg-warning",
  over: "bg-destructive",
}

export const FILL_CARD: Record<FillLevel, string> = {
  ok: "",
  warn: "ring-warning/50",
  over: "ring-destructive/50",
}

export function formatPercent(percent: number): string {
  return `${new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 1 }).format(percent)}%`
}
