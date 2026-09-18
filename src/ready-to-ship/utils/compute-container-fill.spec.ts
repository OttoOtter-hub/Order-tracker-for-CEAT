import {
  computeTotalPossibleContainers,
  fillContribution,
  isOverfilled,
  toFillPercent,
} from "./compute-container-fill";

describe("fillContribution", () => {
  it("is allocatedQty / loadability", () => {
    expect(fillContribution(50, 200)).toBe(0.25);
  });

  it("is 0 without a usable loadability instead of NaN/Infinity", () => {
    expect(fillContribution(50, null)).toBe(0);
    expect(fillContribution(50, 0)).toBe(0);
  });
});

describe("isOverfilled", () => {
  it("is false at exactly 100% and true above it", () => {
    expect(isOverfilled(1)).toBe(false);
    expect(isOverfilled(1.01)).toBe(true);
  });

  it("ignores float noise just above 100%", () => {
    expect(2 / 2 + 33 / 25 + 34 / 50).toBeGreaterThan(3); // the noise this guards against
    expect(isOverfilled(1.0000000000000002)).toBe(false);
  });
});

describe("toFillPercent", () => {
  it("rounds to two decimals", () => {
    expect(toFillPercent(0.123456)).toBe(12.35);
    expect(toFillPercent(1.5)).toBe(150);
  });
});

describe("computeTotalPossibleContainers", () => {
  it("rounds the summed container-equivalents up", () => {
    expect(
      computeTotalPossibleContainers([
        { dispatchQty: 150, loadability: 100 }, // 1.5
        { dispatchQty: 20, loadability: 200 }, // 0.1
      ]),
    ).toBe(2);
  });

  it("does not round an exact integer sum up because of float noise", () => {
    // Sums to exactly 3 on paper, but 3.0000000000000004 in floating point.
    const total = computeTotalPossibleContainers([
      { dispatchQty: 2, loadability: 2 },
      { dispatchQty: 33, loadability: 25 },
      { dispatchQty: 34, loadability: 50 },
    ]);
    expect(total).toBe(3);
  });

  it("ignores lines without a loadability rather than counting them as infinite", () => {
    expect(
      computeTotalPossibleContainers([
        { dispatchQty: 100, loadability: 100 },
        { dispatchQty: 500, loadability: null },
        { dispatchQty: 500, loadability: 0 },
      ]),
    ).toBe(1);
  });

  it("is 0 for an empty list", () => {
    expect(computeTotalPossibleContainers([])).toBe(0);
  });
});
