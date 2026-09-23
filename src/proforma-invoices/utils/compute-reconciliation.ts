import { ActualContainerLineItem } from "../../actual-containers/actual-container-line-item.entity";
import { toNumberOrNull } from "../../common/utils/numeric";
import { ContainerLineAllocation } from "../../ready-to-ship/container-line-allocation.entity";
import { PiLineItem } from "../../pi-line-items/pi-line-item.entity";

export interface ReconciliationRow {
  materialNum: string;
  materialDesc: string | null;
  /** Σ allocatedQty over this material's *locked* allocations (Phase 16: per-position, not per-container). */
  plannedQty: number;
  /** Σ quantity over this PI's ActualContainerLineItem rows for this material. */
  shippedQty: number;
  /** shippedQty - plannedQty; can go either way, purely informational (no alert/threshold). */
  delta: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Plan-vs-actual, quantities only (no pricing — that's a later phase), grouped
 * by material_num *within this one PI card* — not by PiLineItem row, since the
 * same material can appear on several SO rows of the same PI and those belong
 * together for this comparison.
 *
 * - plannedQty only counts *locked* allocations (`allocation.isLocked` —
 *   Phase 16 moved locking from the whole container down to each position) —
 *   an unlocked one is not a plan yet, so this function itself does that
 *   filtering (not the caller), which is what makes the rule unit-testable
 *   without a database.
 * - shippedQty is matched the same way PI.shippedQty already is (by piNumber,
 *   see ActualContainersImportService.recomputeShippedQty), just split by
 *   material instead of summed once — `actualLines` should already be
 *   filtered to this PI's piNumber by the caller.
 * - A group only exists for materials that appear on this PI's own line
 *   items; an ActualContainerLineItem for a material the PI's current line
 *   items don't have (e.g. a superseded row) contributes to no row, the same
 *   way "совпадает с группой" reads in the spec — it doesn't invent a new one.
 * - Line items with no material number (never seen in practice, but the
 *   column is nullable) are left out of the grouping entirely — there is no
 *   key to group them by.
 *
 * Returns one row per material regardless of whether it has any activity —
 * whether to hide an all-zero block is a display decision, made by the
 * frontend, not this function.
 */
export function computeReconciliation(
  lineItems: PiLineItem[],
  allocations: ContainerLineAllocation[],
  actualLines: ActualContainerLineItem[],
): ReconciliationRow[] {
  const materialByLineItemId = new Map<string, string>();
  const materialDescByMaterial = new Map<string, string | null>();
  for (const item of lineItems) {
    if (!item.materialNum) {
      continue;
    }
    materialByLineItemId.set(item.id, item.materialNum);
    if (!materialDescByMaterial.has(item.materialNum)) {
      materialDescByMaterial.set(item.materialNum, item.materialDesc);
    }
  }

  const plannedByMaterial = new Map<string, number>();
  for (const allocation of allocations) {
    if (!allocation.isLocked || !allocation.piLineItem) {
      continue;
    }
    const material = materialByLineItemId.get(allocation.piLineItem.id);
    if (!material) {
      continue;
    }
    plannedByMaterial.set(
      material,
      (plannedByMaterial.get(material) ?? 0) +
        (toNumberOrNull(allocation.allocatedQty) ?? 0),
    );
  }

  const shippedByMaterial = new Map<string, number>();
  for (const line of actualLines) {
    if (!line.materialNum || !materialDescByMaterial.has(line.materialNum)) {
      continue;
    }
    shippedByMaterial.set(
      line.materialNum,
      (shippedByMaterial.get(line.materialNum) ?? 0) +
        (toNumberOrNull(line.quantity) ?? 0),
    );
  }

  return [...materialDescByMaterial.entries()]
    .map(([materialNum, materialDesc]) => {
      const plannedQty = round2(plannedByMaterial.get(materialNum) ?? 0);
      const shippedQty = round2(shippedByMaterial.get(materialNum) ?? 0);
      return {
        materialNum,
        materialDesc,
        plannedQty,
        shippedQty,
        delta: round2(shippedQty - plannedQty),
      };
    })
    .sort((a, b) => a.materialNum.localeCompare(b.materialNum));
}
