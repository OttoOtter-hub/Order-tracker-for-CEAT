interface CellValueLike {
  result?: unknown;
}

export function unwrapFormula(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    !(value instanceof Date) &&
    "result" in (value as CellValueLike)
  ) {
    return (value as CellValueLike).result;
  }
  return value;
}

export function toStringOrNull(value: unknown): string | null {
  const unwrapped = unwrapFormula(value);
  if (unwrapped === null || unwrapped === undefined) {
    return null;
  }
  const str = String(unwrapped).trim();
  return str.length > 0 ? str : null;
}

export function toNumberOrNull(value: unknown): number | null {
  const unwrapped = unwrapFormula(value);
  if (unwrapped === null || unwrapped === undefined || unwrapped === "") {
    return null;
  }
  const num = typeof unwrapped === "number" ? unwrapped : Number(unwrapped);
  return Number.isFinite(num) ? num : null;
}

/**
 * For identifier-like cells (invoice numbers, vessel names) where the source
 * system writes a literal 0 when there is nothing to say — observed in the
 * real ETD-ETA sheet ("Preshipment Invoice" = 0 for 40 of 77 containers,
 * "Vessel Name" = 0 for 11). A zero is never a real invoice/vessel, so it
 * reads as empty rather than the string "0". Numbers are rendered without a
 * decimal tail ("340287277", not "340287277.0").
 */
export function toIdentifierOrNull(value: unknown): string | null {
  const unwrapped = unwrapFormula(value);
  if (typeof unwrapped === "number") {
    if (!Number.isFinite(unwrapped) || unwrapped === 0) {
      return null;
    }
    return String(unwrapped);
  }
  if (unwrapped instanceof Date) {
    return null;
  }
  return toStringOrNull(unwrapped);
}

const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;
const FIRST_REAL_DATE_UTC_MS = Date.UTC(1900, 0, 1);

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * A calendar day as "YYYY-MM-DD", or null for "no date". Excel stores an empty
 * date as 0, which a date-formatted cell reads back as 1899-12-30 — the real
 * file has that in 50 of 77 ETA cells — so anything before 1900 means "not
 * set", not a shipment in the 19th century. Also accepts a raw Excel serial
 * number and ISO / dd.mm.yyyy text, since a cell that lost its date format
 * arrives as one of those.
 */
export function toDateOrNull(value: unknown): string | null {
  const unwrapped = unwrapFormula(value);
  if (unwrapped === null || unwrapped === undefined || unwrapped === "") {
    return null;
  }
  if (unwrapped instanceof Date) {
    const time = unwrapped.getTime();
    return Number.isNaN(time) || time < FIRST_REAL_DATE_UTC_MS
      ? null
      : isoDay(unwrapped);
  }
  if (typeof unwrapped === "number") {
    if (!Number.isFinite(unwrapped) || unwrapped < 1) {
      return null;
    }
    return isoDay(
      new Date(EXCEL_EPOCH_UTC_MS + Math.floor(unwrapped) * MS_PER_DAY),
    );
  }
  if (typeof unwrapped === "string") {
    const text = unwrapped.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text);
    const parts = iso
      ? { y: +iso[1], m: +iso[2], d: +iso[3] }
      : dmy
        ? { y: +dmy[3], m: +dmy[2], d: +dmy[1] }
        : null;
    if (!parts) {
      return null;
    }
    const date = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
    const valid =
      date.getUTCFullYear() === parts.y &&
      date.getUTCMonth() === parts.m - 1 &&
      date.getUTCDate() === parts.d;
    return valid && parts.y >= 1900 ? isoDay(date) : null;
  }
  return null;
}
