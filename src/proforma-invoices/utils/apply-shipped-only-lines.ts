import { PiLineItem } from "../../pi-line-items/pi-line-item.entity";
import { toNumberOrNull } from "../../common/utils/numeric";
import { sumByLoadabilityGroups } from "../../common/utils/sum-by-loadability";

/** The Dispatch (ActualContainerLineItem) columns this needs, for one PI. */
export interface DispatchLine {
  materialNum: string | null;
  materialDesc: string | null;
  quantity: string | number | null;
}

/** The card fields this reads and (for the response only) rewrites. */
export interface ShippedOnlyTarget {
  id: string;
  isArchivedShipped: boolean;
  lineItems?: PiLineItem[];
  totalQty: string | null;
  totalContainers: string | null;
  qtyPending: string | null;
  containersPending: string | null;
  currentWeekPlanQty: string | null;
  currentWeekPlanContainers: string | null;
}

interface ShippedMaterial {
  materialNum: string;
  materialDesc: string | null;
  quantity: number;
  loadability: number | null;
}

const money = (value: number): string => value.toFixed(2);

/** Σ Dispatch quantity per material, in first-seen order (description from Dispatch). */
function groupDispatch(
  lines: DispatchLine[],
  loadabilityByMaterial: ReadonlyMap<string, number>,
): Map<string, ShippedMaterial> {
  const byMaterial = new Map<string, ShippedMaterial>();
  for (const line of lines) {
    if (!line.materialNum) continue;
    const qty = toNumberOrNull(line.quantity) ?? 0;
    const existing = byMaterial.get(line.materialNum);
    if (existing) {
      existing.quantity += qty;
      existing.materialDesc ??= line.materialDesc;
    } else {
      byMaterial.set(line.materialNum, {
        materialNum: line.materialNum,
        materialDesc: line.materialDesc,
        quantity: qty,
        loadability: loadabilityByMaterial.get(line.materialNum) ?? null,
      });
    }
  }
  return byMaterial;
}

/**
 * A read-only row for a material that is only in Dispatch: fully shipped,
 * nothing left (balance 0), no SO / MT, no priority to set. Never saved —
 * the id is synthetic and only keeps the frontend's row keys unique.
 */
function toShippedOnlyLine(piId: string, m: ShippedMaterial): PiLineItem {
  const line = new PiLineItem();
  Object.assign(line, {
    id: `shipped:${piId}:${m.materialNum}`,
    soNumber: null,
    materialNum: m.materialNum,
    materialDesc: m.materialDesc,
    balanceToBeDelivered: "0",
    quantity: money(m.quantity),
    mt: null,
    loadFactor: m.loadability ? "0" : null,
    loadability: m.loadability === null ? null : String(m.loadability),
    currentWeekDispatchLoadFactor: null,
    currentWeekDispatchQty: null,
    priorityQty: "0",
    isShippedOnly: true,
  });
  return line;
}

const containers = (materials: ShippedMaterial[]): number =>
  sumByLoadabilityGroups(
    materials.map((m) => ({ value: m.quantity, loadability: m.loadability })),
  );

/**
 * Fully shipped materials on a PI card, computed on read (no migration):
 * PiLineItem is built only from the backorder, so a material that has left
 * the backorder completely would vanish from the card and its totals. It is
 * taken back from Dispatch (ActualContainerLineItem rows with this PI's
 * number — same matching as shippedQty / reconciliation, Phase 12):
 *
 * - **Active card:** a Dispatch material that none of the card's own line
 *   items has gets an `isShippedOnly` row: quantity = Σ Dispatch quantity,
 *   balance 0. A material in both sources is *not* added — the backorder's
 *   Quantity already includes what has shipped. totalQty grows by those
 *   quantities, totalContainers by quantity / loadability where the SKU's
 *   loadability is known (from any PiLineItem in the database); without it
 *   the row still shows but adds no containers. Pending qty/containers and
 *   the week plan don't change — those rows have nothing left.
 * - **Archived card with Dispatch lines:** its line items are the last
 *   backorder's leftovers, stale by definition. The card shows its Dispatch
 *   materials instead (all `isShippedOnly`), with totals from them and
 *   everything pending / planned at 0. An archived card with no Dispatch
 *   lines is left exactly as stored.
 *
 * Mutates `pi` — only ever call it on an instance that goes to the response,
 * never on one a write path might save (ProformaInvoicesService keeps the
 * two apart).
 */
export function applyShippedOnlyLines(
  pi: ShippedOnlyTarget,
  dispatchLines: DispatchLine[],
  loadabilityByMaterial: ReadonlyMap<string, number>,
): void {
  const own = pi.lineItems ?? [];
  for (const item of own) item.isShippedOnly = false;
  const shipped = groupDispatch(dispatchLines, loadabilityByMaterial);
  if (shipped.size === 0) return;

  if (pi.isArchivedShipped) {
    const all = [...shipped.values()];
    pi.lineItems = all.map((m) => toShippedOnlyLine(pi.id, m));
    pi.totalQty = money(all.reduce((sum, m) => sum + m.quantity, 0));
    pi.totalContainers = money(containers(all));
    pi.qtyPending = money(0);
    pi.containersPending = money(0);
    pi.currentWeekPlanQty = money(0);
    pi.currentWeekPlanContainers = money(0);
    return;
  }

  const ownMaterials = new Set(
    own.map((item) => item.materialNum).filter((m): m is string => !!m),
  );
  const extra = [...shipped.values()].filter(
    (m) => !ownMaterials.has(m.materialNum),
  );
  if (extra.length === 0) return;

  pi.lineItems = [...own, ...extra.map((m) => toShippedOnlyLine(pi.id, m))];
  const extraQty = extra.reduce((sum, m) => sum + m.quantity, 0);
  pi.totalQty = money((toNumberOrNull(pi.totalQty) ?? 0) + extraQty);
  const extraContainers = containers(extra);
  if (extraContainers > 0 || pi.totalContainers !== null) {
    pi.totalContainers = money(
      (toNumberOrNull(pi.totalContainers) ?? 0) + extraContainers,
    );
  }
}

/**
 * Loadability is a property of the SKU: one value per material, taken from
 * any line item in the database — the most frequent positive value, so one
 * odd row can't win (ties go to the first seen).
 */
export function loadabilityByMaterial(
  rows: Array<{ materialNum: string | null; loadability: string | null }>,
): Map<string, number> {
  const counts = new Map<string, Map<number, number>>();
  for (const row of rows) {
    const value = toNumberOrNull(row.loadability);
    if (!row.materialNum || !value || value <= 0) continue;
    const perValue = counts.get(row.materialNum) ?? new Map<number, number>();
    perValue.set(value, (perValue.get(value) ?? 0) + 1);
    counts.set(row.materialNum, perValue);
  }
  const result = new Map<string, number>();
  for (const [material, perValue] of counts) {
    let best: number | null = null;
    let bestCount = 0;
    for (const [value, count] of perValue) {
      if (count > bestCount) {
        best = value;
        bestCount = count;
      }
    }
    if (best !== null) result.set(material, best);
  }
  return result;
}
