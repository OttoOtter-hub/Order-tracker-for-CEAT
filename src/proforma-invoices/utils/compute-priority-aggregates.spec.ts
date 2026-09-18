import { computePriorityAggregates } from "./compute-priority-aggregates";
import { PiLineItem } from "../../pi-line-items/pi-line-item.entity";

function makeLineItem(overrides: Partial<PiLineItem> = {}): PiLineItem {
  return Object.assign(new PiLineItem(), {
    priorityQty: "0",
    loadability: null,
    ...overrides,
  });
}

describe("computePriorityAggregates", () => {
  it("sums priorityQty straight across line items", () => {
    const agg = computePriorityAggregates([
      makeLineItem({ priorityQty: "4.00" }),
      makeLineItem({ priorityQty: "6.50" }),
    ]);
    expect(agg.priorityTotalQty).toBeCloseTo(10.5);
  });

  it("derives priorityTotalContainers as priorityQty grouped by loadability, divided once per group", () => {
    const agg = computePriorityAggregates([
      makeLineItem({ priorityQty: "4", loadability: "20" }),
      makeLineItem({ priorityQty: "6", loadability: "20" }),
      makeLineItem({ priorityQty: "10", loadability: "50" }),
    ]);
    expect(agg.priorityTotalContainers).toBeCloseTo((4 + 6) / 20 + 10 / 50);
  });

  it("treats a row with no/zero loadability as contributing 0 containers, not NaN", () => {
    const agg = computePriorityAggregates([
      makeLineItem({ priorityQty: "5", loadability: null }),
      makeLineItem({ priorityQty: "5", loadability: "0" }),
    ]);
    expect(agg.priorityTotalContainers).toBe(0);
    expect(agg.priorityTotalQty).toBe(10);
  });

  it("returns all zeros for an empty line item set", () => {
    expect(computePriorityAggregates([])).toEqual({
      priorityTotalQty: 0,
      priorityTotalContainers: 0,
    });
  });
});
