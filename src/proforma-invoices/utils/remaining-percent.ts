import { toNumberOrNull } from "../../common/utils/numeric";

/**
 * How much of a card is still to ship, in percent of its total quantity:
 * qtyPending / totalQty × 100, to one decimal. null when there is nothing to
 * measure against — no line items, or a total of 0 / unknown. A remainder
 * that exists is never shown as 0: anything above 0 is at least 0.1.
 *
 * Reads the card as returned (fully shipped rows included in totalQty — see
 * applyShippedOnlyLines), so the list, the card and its Excel agree.
 */
export function computeRemainingPercent(
  totalQty: string | number | null | undefined,
  qtyPending: string | number | null | undefined,
  lineCount: number,
): number | null {
  if (lineCount === 0) return null;
  const total = toNumberOrNull(totalQty);
  if (!total || total <= 0) return null;
  const pending = Math.max(0, toNumberOrNull(qtyPending) ?? 0);
  const percent = Math.min(100, Math.round((pending / total) * 1000) / 10);
  return pending > 0 && percent < 0.1 ? 0.1 : percent;
}

/** 100 − remaining, to one decimal; null when the remainder is. */
export function computeShippedPercent(
  remainingPercent: number | null,
): number | null {
  return remainingPercent === null
    ? null
    : Math.round((100 - remainingPercent) * 10) / 10;
}
