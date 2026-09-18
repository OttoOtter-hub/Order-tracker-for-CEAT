import { toNumberOrNull } from "../../common/utils/numeric";
import { lineItemKey } from "../../pi-line-items/utils/line-item-key";

export interface PairableLineItem {
  id: string;
  materialNum: string | null;
  soNumber: string | null;
  currentWeekDispatchQty: string | null;
  balanceToBeDelivered: string | null;
}

function signature(item: PairableLineItem): string {
  return `${toNumberOrNull(item.currentWeekDispatchQty)}|${toNumberOrNull(item.balanceToBeDelivered)}`;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

/**
 * Pairs each old line item with the new row that replaces it (or null when
 * nothing does), keyed by old id. Rows are matched by (materialNum,
 * soNumber); within one key, which is where a card can hold several rows:
 *   1. an old row takes the new row with the same (dispatch qty, balance) —
 *      when several rows share that signature they are identical for every
 *      purpose here, so they are paired in order;
 *   2. whatever is left on either side is paired in order.
 * A key with a single row on each side always pairs, whatever changed in the
 * numbers between weeks: step 1 only ever decides *which* row of a repeated
 * key an allocation stays on. Pairing is one-to-one, so two old rows never
 * land on the same new row.
 */
export function pairLineItems(
  oldItems: PairableLineItem[],
  newItems: PairableLineItem[],
): Map<string, string | null> {
  const newByKey = groupBy(newItems, (i) =>
    lineItemKey(i.materialNum, i.soNumber),
  );
  const oldByKey = groupBy(oldItems, (i) =>
    lineItemKey(i.materialNum, i.soNumber),
  );
  const result = new Map<string, string | null>();

  for (const [key, olds] of oldByKey) {
    const news = newByKey.get(key) ?? [];
    const newBySignature = groupBy(news, signature);
    const usedNextIndex = new Map<string, number>();
    const usedNewIds = new Set<string>();
    const bySignature = new Map<string, string>();

    for (const old of olds) {
      const sig = signature(old);
      const index = usedNextIndex.get(sig) ?? 0;
      const match = newBySignature.get(sig)?.[index];
      if (match) {
        usedNextIndex.set(sig, index + 1);
        usedNewIds.add(match.id);
        bySignature.set(old.id, match.id);
      }
    }

    const leftovers = news.filter((n) => !usedNewIds.has(n.id));
    let nextLeftover = 0;
    for (const old of olds) {
      result.set(
        old.id,
        bySignature.get(old.id) ?? leftovers[nextLeftover++]?.id ?? null,
      );
    }
  }
  return result;
}
