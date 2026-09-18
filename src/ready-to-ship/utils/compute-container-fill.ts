import { sumByLoadabilityGroups } from "../../common/utils/sum-by-loadability";

/** Absorbs float noise, e.g. 2/2 + 33/25 + 34/50 === 3.0000000000000004. */
const FILL_EPSILON = 1e-9;

export function fillContribution(
  allocatedQty: number,
  loadability: number | null,
): number {
  return loadability && loadability > 0 ? allocatedQty / loadability : 0;
}

export function isOverfilled(fillRatio: number): boolean {
  return fillRatio > 1 + FILL_EPSILON;
}

export function toFillPercent(fillRatio: number): number {
  return Math.round(fillRatio * 10000) / 100;
}

/**
 * Number of container slots a client's current-week dispatch needs: the sum
 * of dispatchQty / loadability over every active line (already-allocated
 * ones included — this is the whole potential, not what's left), rounded
 * up. Same "container-equivalent" formula the PI aggregates use, deliberately
 * NOT the backorder file's own "Current Week Dispatch Plan (Load Factor)"
 * column — see the README note on why that column can't be trusted (it's a
 * Balance/Loadability ratio and is non-zero for rows with no loadability),
 * and it has to agree with the qty/loadability fill math used everywhere
 * else in this feature or the slot count could fall short of what the
 * lines actually need.
 */
export function computeTotalPossibleContainers(
  lines: Array<{ dispatchQty: number; loadability: number | null }>,
): number {
  const total = sumByLoadabilityGroups(
    lines.map((line) => ({
      value: line.dispatchQty,
      loadability: line.loadability,
    })),
  );
  return total > FILL_EPSILON ? Math.ceil(total - FILL_EPSILON) : 0;
}
