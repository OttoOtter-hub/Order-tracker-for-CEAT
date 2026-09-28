import {
  computeRemainingPercent,
  computeShippedPercent,
} from "./remaining-percent";

describe("computeRemainingPercent", () => {
  it("is 0 when nothing is left", () => {
    expect(computeRemainingPercent("400.00", "0.00", 3)).toBe(0);
    expect(computeShippedPercent(0)).toBe(100);
  });

  it("is qtyPending / totalQty × 100 to one decimal: 150 of 400 = 37.5", () => {
    expect(computeRemainingPercent("400", "150", 2)).toBe(37.5);
    expect(computeShippedPercent(37.5)).toBe(62.5);
    expect(computeRemainingPercent("3", "1", 1)).toBe(33.3);
  });

  it("a remainder that exists is at least 0.1, never shown as 0", () => {
    // 1 of 5000 = 0.02 %
    expect(computeRemainingPercent("5000", "1", 10)).toBe(0.1);
    expect(computeShippedPercent(0.1)).toBe(99.9);
  });

  it("no line items, or a total of 0 / unknown: null", () => {
    expect(computeRemainingPercent("400", "10", 0)).toBeNull();
    expect(computeRemainingPercent("0", "0", 3)).toBeNull();
    expect(computeRemainingPercent(null, "5", 3)).toBeNull();
    expect(computeShippedPercent(null)).toBeNull();
  });

  it("never goes above 100 (pending can't exceed the total, but the data is not ours)", () => {
    expect(computeRemainingPercent("10", "12", 1)).toBe(100);
  });
});
