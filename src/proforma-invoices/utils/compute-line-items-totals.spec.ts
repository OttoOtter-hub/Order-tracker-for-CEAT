import { computeLineItemsTotals } from "./compute-line-items-totals";
import { PiLineItem } from "../../pi-line-items/pi-line-item.entity";

function makeLineItem(overrides: Partial<PiLineItem> = {}): PiLineItem {
  return Object.assign(new PiLineItem(), {
    mt: null,
    loadFactor: null,
    currentWeekDispatchLoadFactor: null,
    ...overrides,
  });
}

describe("computeLineItemsTotals", () => {
  it("uses the PI's own aggregates for balance/quantity/current-week qty, not a recomputation", () => {
    const totals = computeLineItemsTotals([], {
      qtyPending: "12.50",
      totalQty: "40.00",
      currentWeekPlanQty: "5.00",
    });
    expect(totals.balanceToBeDelivered).toBe(12.5);
    expect(totals.quantity).toBe(40);
    expect(totals.currentWeekDispatchQty).toBe(5);
  });

  it("sums mt/loadFactor/currentWeekDispatchLoadFactor across the given line items", () => {
    const lineItems = [
      makeLineItem({ mt: "0.284", loadFactor: "0.0299", currentWeekDispatchLoadFactor: "0.0299" }),
      makeLineItem({ mt: "0.120", loadFactor: "0.0163", currentWeekDispatchLoadFactor: null }),
    ];
    const totals = computeLineItemsTotals(lineItems, {
      qtyPending: null,
      totalQty: null,
      currentWeekPlanQty: null,
    });
    expect(totals.mt).toBeCloseTo(0.404);
    expect(totals.loadFactor).toBeCloseTo(0.0462);
    expect(totals.currentWeekDispatchLoadFactor).toBeCloseTo(0.0299);
  });

  it("treats nulls as zero when summing, never NaN", () => {
    const totals = computeLineItemsTotals(
      [makeLineItem(), makeLineItem()],
      { qtyPending: null, totalQty: null, currentWeekPlanQty: null },
    );
    expect(totals.mt).toBe(0);
    expect(totals.loadFactor).toBe(0);
    expect(totals.currentWeekDispatchLoadFactor).toBe(0);
    expect(totals.balanceToBeDelivered).toBeNull();
  });
});
