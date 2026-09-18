import { PiLineItem } from "../../pi-line-items/pi-line-item.entity";
import { toNumberOrNull } from "../../common/utils/numeric";
import { sumByLoadabilityGroups } from "../../common/utils/sum-by-loadability";

export interface PriorityAggregates {
  priorityTotalQty: number;
  priorityTotalContainers: number;
}

/**
 * Live totals over a PI's current priorityQty values — recomputed on every
 * read (ProformaInvoice.priorityTotalQty/priorityTotalContainers getters),
 * never persisted, since priority changes on its own schedule (client
 * edits) independent of backorder uploads, unlike totalQty/totalContainers
 * etc. which are snapshotted at upload time (see computePiAggregates).
 *
 * priorityTotalContainers reuses the same group-by-loadability formula
 * (sumByLoadabilityGroups) as the upload-time aggregates — same
 * "container-equivalent" semantics, just applied to priorityQty instead of
 * quantity/balanceToBeDelivered.
 */
export function computePriorityAggregates(
  lineItems: PiLineItem[],
): PriorityAggregates {
  let priorityTotalQty = 0;
  for (const item of lineItems) {
    priorityTotalQty += toNumberOrNull(item.priorityQty) ?? 0;
  }

  const priorityTotalContainers = sumByLoadabilityGroups(
    lineItems.map((item) => ({
      value: toNumberOrNull(item.priorityQty) ?? 0,
      loadability: toNumberOrNull(item.loadability),
    })),
  );

  return { priorityTotalQty, priorityTotalContainers };
}
