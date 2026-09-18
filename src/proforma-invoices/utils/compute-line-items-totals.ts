import { PiLineItem } from "../../pi-line-items/pi-line-item.entity";
import { toNumberOrNull } from "../../common/utils/numeric";

export interface LineItemsTotals {
  balanceToBeDelivered: number | null;
  quantity: number | null;
  mt: number;
  loadFactor: number;
  currentWeekDispatchLoadFactor: number;
  currentWeekDispatchQty: number | null;
}

/**
 * Same math as the frontend's "Всего" row (PiDetailPage.tsx) — kept
 * consistent on purpose, not just in spirit: balance/quantity/current-week
 * qty reuse the PI's own precomputed aggregates (qtyPending/totalQty/
 * currentWeekPlanQty — computePiAggregates already sums these straight
 * from the same columns, recomputing them here would just be duplicate
 * work), while mt/loadFactor/currentWeekDispatchLoadFactor have no 1:1
 * aggregate on the PI (totalContainers etc. are Qty/Loadability ratios,
 * not straight sums of those columns) and are summed here directly from
 * the loaded line items.
 */
export function computeLineItemsTotals(
  lineItems: PiLineItem[],
  pi: {
    qtyPending: string | null;
    totalQty: string | null;
    currentWeekPlanQty: string | null;
  },
): LineItemsTotals {
  const sum = (
    key: "mt" | "loadFactor" | "currentWeekDispatchLoadFactor",
  ): number =>
    lineItems.reduce((total, item) => {
      const value = toNumberOrNull(item[key]);
      return total + (value ?? 0);
    }, 0);

  return {
    balanceToBeDelivered: toNumberOrNull(pi.qtyPending),
    quantity: toNumberOrNull(pi.totalQty),
    mt: sum("mt"),
    loadFactor: sum("loadFactor"),
    currentWeekDispatchLoadFactor: sum("currentWeekDispatchLoadFactor"),
    currentWeekDispatchQty: toNumberOrNull(pi.currentWeekPlanQty),
  };
}
