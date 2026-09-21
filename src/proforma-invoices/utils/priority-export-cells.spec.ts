import { countPriorityLineItems } from "./compute-priority-aggregates";
import {
  PRIORITY_DASH,
  priorityLoadFactorCell,
  priorityQtyCell,
} from "./priority-export-cells";

describe("priorityQtyCell", () => {
  it("is the quantity when positive, a dash for 0 / missing", () => {
    expect(priorityQtyCell("40.00")).toBe(40);
    expect(priorityQtyCell(12.5)).toBe(12.5);
    expect(priorityQtyCell("0.00")).toBe(PRIORITY_DASH);
    expect(priorityQtyCell("0")).toBe(PRIORITY_DASH);
    expect(priorityQtyCell(null)).toBe(PRIORITY_DASH);
    expect(priorityQtyCell(undefined)).toBe(PRIORITY_DASH);
  });
});

describe("priorityLoadFactorCell", () => {
  it("is priorityQty / loadability to 4 places", () => {
    expect(priorityLoadFactorCell("40.00", "200.0000")).toBe(0.2);
    expect(priorityLoadFactorCell("1", "3")).toBe(0.3333);
    expect(priorityLoadFactorCell("2", "3")).toBe(0.6667);
  });

  it("is a dash without a priority or without a usable loadability", () => {
    expect(priorityLoadFactorCell("0", "100")).toBe(PRIORITY_DASH);
    expect(priorityLoadFactorCell(null, "100")).toBe(PRIORITY_DASH);
    expect(priorityLoadFactorCell("5", null)).toBe(PRIORITY_DASH);
    expect(priorityLoadFactorCell("5", "0")).toBe(PRIORITY_DASH);
    expect(priorityLoadFactorCell("5", undefined)).toBe(PRIORITY_DASH);
  });
});

describe("countPriorityLineItems", () => {
  it("counts the items whose priorityQty is above zero", () => {
    expect(
      countPriorityLineItems([
        { priorityQty: "1.00" },
        { priorityQty: "0.00" },
        { priorityQty: "9" },
      ] as any),
    ).toBe(2);
    expect(countPriorityLineItems([])).toBe(0);
  });
});
