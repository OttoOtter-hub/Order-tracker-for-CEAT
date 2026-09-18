import { computePiAggregates } from "./compute-pi-aggregates";
import { ParsedBackorderRow } from "./parse-backorder-file";

function row(overrides: Partial<ParsedBackorderRow> = {}): ParsedBackorderRow {
  return {
    piNumber: "100037320",
    soNumber: "300029159",
    materialNum: "107071",
    materialDesc: "some tyre",
    balanceToBeDelivered: null,
    quantity: null,
    mt: null,
    loadFactor: null,
    loadability: null,
    currentWeekDispatchLoadFactor: null,
    currentWeekDispatchQty: null,
    ...overrides,
  };
}

describe("computePiAggregates", () => {
  it("sums quantity/balance/current-week-plan columns straight across rows", () => {
    const rows = [
      row({ quantity: 2, balanceToBeDelivered: 2, currentWeekDispatchQty: 2 }),
      row({ quantity: 4, balanceToBeDelivered: 0, currentWeekDispatchQty: 0 }),
    ];
    const agg = computePiAggregates(rows);
    expect(agg.totalQty).toBe(6);
    expect(agg.qtyPending).toBe(2);
    expect(agg.currentWeekPlanQty).toBe(2);
  });

  it("computes totalContainers from raw quantity/loadability, not the file's own Load Factor column", () => {
    const rows = [
      // loadFactor deliberately wrong/stale here — must be ignored.
      row({ quantity: 2, loadability: 22, loadFactor: 999 }),
      row({ quantity: 10, loadability: 62, loadFactor: 999 }),
    ];
    const agg = computePiAggregates(rows);
    expect(agg.totalContainers).toBeCloseTo(2 / 22 + 10 / 62);
  });

  it("sums raw quantities for rows sharing the same loadability before dividing once, not once per row", () => {
    const rows = [
      row({ quantity: 2, loadability: 22 }),
      row({ quantity: 4, loadability: 22 }),
    ];
    const agg = computePiAggregates(rows);
    // A single division of the combined quantity, not two separate
    // divisions summed — same result here since division distributes over
    // addition, but exercises the grouped code path (see the "loadability
    // = 0 pollutes nothing" test below for where this actually matters).
    expect(agg.totalContainers).toBeCloseTo((2 + 4) / 22);
  });

  it("derives containersPending as grouped balanceToBeDelivered / loadability", () => {
    const rows = [
      row({ balanceToBeDelivered: 2, loadability: 22 }),
      row({ balanceToBeDelivered: 6, loadability: 62 }),
    ];
    const agg = computePiAggregates(rows);
    expect(agg.containersPending).toBeCloseTo(2 / 22 + 6 / 62);
  });

  it("treats a row with no loadability as contributing 0 pending containers, not NaN/Infinity", () => {
    const agg = computePiAggregates([
      row({ balanceToBeDelivered: 5, loadability: null }),
    ]);
    expect(agg.containersPending).toBe(0);
    expect(agg.totalContainers).toBe(0);
    expect(Number.isFinite(agg.containersPending)).toBe(true);
  });

  it("treats a row with loadability=0 the same as missing, not a division by zero", () => {
    const agg = computePiAggregates([row({ quantity: 5, loadability: 0 })]);
    expect(agg.totalContainers).toBe(0);
    expect(Number.isFinite(agg.totalContainers)).toBe(true);
  });

  it("still counts a zero-loadability row's quantity toward totalQty", () => {
    const agg = computePiAggregates([row({ quantity: 5, loadability: 0 })]);
    expect(agg.totalQty).toBe(5);
  });

  it("returns all zeros for an empty row set", () => {
    expect(computePiAggregates([])).toEqual({
      totalQty: 0,
      totalContainers: 0,
      qtyPending: 0,
      containersPending: 0,
      currentWeekPlanContainers: 0,
      currentWeekPlanQty: 0,
    });
  });
});
