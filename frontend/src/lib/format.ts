// How a PI is named wherever its number is shown: "100039270: Орел", or just
// "100039270" when the card has no label (no dangling colon).
export function formatPiTitle(
  piNumber: string,
  label: string | null | undefined
): string {
  const trimmed = label?.trim()
  return trimmed ? `${piNumber}: ${trimmed}` : piNumber
}

export function formatCurrency(
  value: string | null | undefined,
  currency = "USD"
): string {
  if (value === null || value === undefined) {
    return "—"
  }
  const numeric = Number(value)
  if (Number.isNaN(numeric)) {
    return "—"
  }
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(numeric)
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) {
    return "—"
  }
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) {
    return "—"
  }
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)
}

// A calendar day ("YYYY-MM-DD", what the API sends for `date` columns such as
// ETD/ETA) has no time zone. Going through `new Date(...)` would read it as UTC
// midnight and print the previous day anywhere west of Greenwich, so the parts
// are formatted as they are.
export function formatDay(value: string | null | undefined): string {
  if (!value) {
    return "—"
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) {
    return value
  }
  return `${match[3]}.${match[2]}.${match[1]}`
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) {
    return "—"
  }
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) {
    return "—"
  }
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

// Numeric columns (Quantity, MT, Load Factor, ...) serialize as strings —
// pg returns `numeric` as text, not a JS number, to avoid float precision
// surprises on the backend.
export function formatNumber(
  value: string | null | undefined,
  maximumFractionDigits = 2
): string {
  if (value === null || value === undefined) {
    return "—"
  }
  const numeric = Number(value)
  if (Number.isNaN(numeric)) {
    return "—"
  }
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits }).format(
    numeric
  )
}
