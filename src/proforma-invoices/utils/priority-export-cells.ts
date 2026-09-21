import { toNumberOrNull } from "../../common/utils/numeric";

/** What the priority columns show for "nothing to say" — a dash, never a 0. */
export const PRIORITY_DASH = "—";

/** Priority Qty cell: the quantity, or a dash when it is 0 / missing. */
export function priorityQtyCell(
  priorityQty: string | number | null | undefined,
): number | string {
  const qty = toNumberOrNull(priorityQty) ?? 0;
  return qty > 0 ? qty : PRIORITY_DASH;
}

/**
 * Priority Load Factor cell: priorityQty / loadability to 4 places, or a dash
 * when there is no priority or the line has no (or a zero) loadability.
 */
export function priorityLoadFactorCell(
  priorityQty: string | number | null | undefined,
  loadability: string | number | null | undefined,
): number | string {
  const qty = toNumberOrNull(priorityQty) ?? 0;
  const perContainer = toNumberOrNull(loadability) ?? 0;
  if (qty <= 0 || perContainer <= 0) {
    return PRIORITY_DASH;
  }
  return Math.round((qty / perContainer) * 10000) / 10000;
}
