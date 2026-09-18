import { ParsedBackorderRow } from "./parse-backorder-file";
import { sumByLoadabilityGroups } from "../../common/utils/sum-by-loadability";

export interface PiAggregates {
  totalQty: number;
  totalContainers: number;
  qtyPending: number;
  containersPending: number;
  currentWeekPlanContainers: number;
  currentWeekPlanQty: number;
}

/**
 * Per-PI totals across its backorder rows, recomputed on every upload.
 *
 * - totalQty / qtyPending / currentWeekPlanQty: straight sums of Quantity /
 *   Balance To be Delivered / Current Week Dispatch Plan (Qty) — no
 *   division involved, so no precision concern.
 * - totalContainers / containersPending / currentWeekPlanContainers:
 *   "container-equivalents" — Quantity / Balance / Current Week Dispatch
 *   Qty divided by that material's Loadability (units per container),
 *   mirroring the totalQty/qtyPending split (total = full order,
 *   pending = what's left). The actual grouping/division is
 *   sumByLoadabilityGroups (common/utils/sum-by-loadability.ts) — shared
 *   with computePriorityAggregates (proforma-invoices/utils), which applies
 *   the same formula to priorityQty on live PiLineItems instead of a
 *   freshly-parsed upload.
 *
 *   Deliberately NOT reusing the source file's own "Load Factor" /
 *   "Current Week Dispatch Plan (Load Factor)" columns: investigating a
 *   real export showed those are themselves Balance/Loadability (not
 *   Quantity/Loadability — confirmed by comparing rows where the two
 *   differ, i.e. partially-shipped orders) and carry their own data-
 *   quality gaps — 18 real rows had loadability = 0 yet a nonzero Load
 *   Factor already baked in (stale/orphaned master data), which would
 *   silently inflate any aggregate that trusted the column outright. Since
 *   that source column is actually the *pending* ratio anyway, trusting it
 *   for totalContainers would have mislabeled "pending" as "total".
 *   Recomputing from the raw columns keeps totalContainers/qtyPending's
 *   semantics honest and consistent with each other.
 *
 *   Rows with no loadability (missing/zero in the source) contribute to
 *   the *Qty sums above but not to the container totals — dividing by
 *   zero/undefined isn't meaningful.
 */
export function computePiAggregates(
  rows: ParsedBackorderRow[],
): PiAggregates {
  let totalQty = 0;
  let qtyPending = 0;
  let currentWeekPlanQty = 0;
  for (const row of rows) {
    totalQty += row.quantity ?? 0;
    qtyPending += row.balanceToBeDelivered ?? 0;
    currentWeekPlanQty += row.currentWeekDispatchQty ?? 0;
  }

  const totalContainers = sumByLoadabilityGroups(
    rows.map((row) => ({ value: row.quantity ?? 0, loadability: row.loadability })),
  );
  const containersPending = sumByLoadabilityGroups(
    rows.map((row) => ({
      value: row.balanceToBeDelivered ?? 0,
      loadability: row.loadability,
    })),
  );
  const currentWeekPlanContainers = sumByLoadabilityGroups(
    rows.map((row) => ({
      value: row.currentWeekDispatchQty ?? 0,
      loadability: row.loadability,
    })),
  );

  return {
    totalQty,
    totalContainers,
    qtyPending,
    containersPending,
    currentWeekPlanContainers,
    currentWeekPlanQty,
  };
}
