import { PiLineItem } from "../../pi-line-items/pi-line-item.entity";
import {
  applyShippedOnlyLines,
  loadabilityByMaterial,
  ShippedOnlyTarget,
} from "./apply-shipped-only-lines";

function line(overrides: Partial<PiLineItem>): PiLineItem {
  return Object.assign(new PiLineItem(), {
    id: "li",
    soNumber: "SO1",
    materialNum: "M",
    materialDesc: "tyre",
    balanceToBeDelivered: "0",
    quantity: "0",
    mt: "1",
    loadFactor: "0",
    loadability: "100",
    currentWeekDispatchLoadFactor: "0",
    currentWeekDispatchQty: "0",
    priorityQty: "0",
    ...overrides,
  });
}

function card(overrides: Partial<ShippedOnlyTarget> = {}): ShippedOnlyTarget {
  return {
    id: "pi-1",
    isArchivedShipped: false,
    // Backorder: M1 ordered 100 (40 left), M2 ordered 50 (all left).
    lineItems: [
      line({
        id: "li-1",
        materialNum: "M1",
        quantity: "100",
        balanceToBeDelivered: "40",
        loadability: "100",
      }),
      line({
        id: "li-2",
        materialNum: "M2",
        quantity: "50",
        balanceToBeDelivered: "50",
        loadability: "25",
      }),
    ],
    totalQty: "150.00",
    totalContainers: "3.00", // 100/100 + 50/25
    qtyPending: "90.00",
    containersPending: "2.40",
    currentWeekPlanQty: "10.00",
    currentWeekPlanContainers: "0.10",
    ...overrides,
  };
}

const LOADABILITY = new Map([
  ["M1", 100],
  ["M2", 25],
  ["M3", 200],
]);

describe("applyShippedOnlyLines", () => {
  it("adds a fully shipped material (only in Dispatch) as an isShippedOnly row: Σ quantity over containers, balance 0", () => {
    const pi = card();
    applyShippedOnlyLines(
      pi,
      [
        { materialNum: "M3", materialDesc: "Shipped tyre", quantity: "120" },
        { materialNum: "M3", materialDesc: null, quantity: "80.00" }, // second container
      ],
      LOADABILITY,
    );

    const added = pi.lineItems!.filter((l) => l.isShippedOnly);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      id: "shipped:pi-1:M3",
      materialNum: "M3",
      materialDesc: "Shipped tyre",
      quantity: "200.00",
      balanceToBeDelivered: "0",
      soNumber: null,
      mt: null,
      loadability: "200",
      priorityQty: "0",
      isShippedOnly: true,
    });
    expect(added[0]).toBeInstanceOf(PiLineItem);
    // The card's own rows stay, marked as not shipped-only.
    expect(
      pi.lineItems!.filter((l) => !l.isShippedOnly).map((l) => l.id),
    ).toEqual(["li-1", "li-2"]);
  });

  it("does not duplicate a partially shipped material that is still in the backorder (its Quantity already includes the shipped part)", () => {
    const pi = card();
    applyShippedOnlyLines(
      pi,
      [{ materialNum: "M1", materialDesc: "tyre", quantity: "60" }],
      LOADABILITY,
    );

    expect(pi.lineItems).toHaveLength(2);
    expect(pi.lineItems!.some((l) => l.isShippedOnly)).toBe(false);
    expect(pi.totalQty).toBe("150.00");
    expect(pi.totalContainers).toBe("3.00");
  });

  it("folds shipped-only rows into totalQty and totalContainers; pending and the week plan stay", () => {
    const pi = card();
    applyShippedOnlyLines(
      pi,
      [
        { materialNum: "M1", materialDesc: "tyre", quantity: "60" }, // in both — ignored
        { materialNum: "M3", materialDesc: "x", quantity: "300" }, // 300 / 200 = 1.5 containers
      ],
      LOADABILITY,
    );

    expect(pi.totalQty).toBe("450.00");
    expect(pi.totalContainers).toBe("4.50");
    expect(pi.qtyPending).toBe("90.00");
    expect(pi.containersPending).toBe("2.40");
    expect(pi.currentWeekPlanQty).toBe("10.00");
    expect(pi.currentWeekPlanContainers).toBe("0.10");
  });

  it("a material with no known loadability still shows and counts in totalQty, but adds no containers and doesn't break the total", () => {
    const pi = card();
    applyShippedOnlyLines(
      pi,
      [{ materialNum: "UNKNOWN", materialDesc: "new SKU", quantity: "70" }],
      LOADABILITY,
    );

    const added = pi.lineItems!.find((l) => l.isShippedOnly)!;
    expect(added).toMatchObject({ loadability: null, loadFactor: null });
    expect(pi.totalQty).toBe("220.00");
    expect(pi.totalContainers).toBe("3.00");
    expect(Number.isFinite(Number(pi.totalContainers))).toBe(true);
  });

  it("a card with no stored totals (created from a PI upload) gets totals from the shipped rows alone", () => {
    const pi = card({ lineItems: [], totalQty: null, totalContainers: null });
    applyShippedOnlyLines(
      pi,
      [{ materialNum: "M2", materialDesc: "x", quantity: "50" }],
      LOADABILITY,
    );

    expect(pi.totalQty).toBe("50.00");
    expect(pi.totalContainers).toBe("2.00");
  });

  it("no Dispatch lines, or none for new materials: the card is left exactly as stored", () => {
    const untouched = card();
    applyShippedOnlyLines(untouched, [], LOADABILITY);
    expect(untouched).toEqual({ ...card(), lineItems: untouched.lineItems });
    expect(untouched.totalQty).toBe("150.00");

    const noKey = card();
    applyShippedOnlyLines(
      noKey,
      [{ materialNum: null, materialDesc: "?", quantity: "5" }],
      LOADABILITY,
    );
    expect(noKey.lineItems).toHaveLength(2);
    expect(noKey.totalQty).toBe("150.00");
  });

  describe("archived card (its line items are the last backorder's leftovers)", () => {
    it("with Dispatch lines: shows the Dispatch materials instead of the stale rows, nothing pending", () => {
      const pi = card({ isArchivedShipped: true });
      applyShippedOnlyLines(
        pi,
        [
          { materialNum: "M1", materialDesc: "tyre 1", quantity: "100" },
          { materialNum: "M2", materialDesc: "tyre 2", quantity: "30" },
          { materialNum: "M2", materialDesc: "tyre 2", quantity: "20" },
        ],
        LOADABILITY,
      );

      expect(
        pi.lineItems!.map((l) => [
          l.materialNum,
          l.quantity,
          l.balanceToBeDelivered,
          l.isShippedOnly,
        ]),
      ).toEqual([
        ["M1", "100.00", "0", true],
        ["M2", "50.00", "0", true],
      ]);
      expect(pi.totalQty).toBe("150.00");
      expect(pi.totalContainers).toBe("3.00");
      expect(pi.qtyPending).toBe("0.00");
      expect(pi.containersPending).toBe("0.00");
      expect(pi.currentWeekPlanQty).toBe("0.00");
      expect(pi.currentWeekPlanContainers).toBe("0.00");
    });

    it("without Dispatch lines: left as stored", () => {
      const pi = card({ isArchivedShipped: true });
      applyShippedOnlyLines(pi, [], LOADABILITY);
      expect(pi.lineItems!.map((l) => l.id)).toEqual(["li-1", "li-2"]);
      expect(pi.qtyPending).toBe("90.00");
    });
  });
});

describe("loadabilityByMaterial", () => {
  it("takes the SKU's most frequent positive loadability from any line item; zero/null/missing are ignored", () => {
    const map = loadabilityByMaterial([
      { materialNum: "A", loadability: "120.0000" },
      { materialNum: "A", loadability: "120" },
      { materialNum: "A", loadability: "90" },
      { materialNum: "B", loadability: "0" },
      { materialNum: "B", loadability: null },
      { materialNum: null, loadability: "50" },
      { materialNum: "C", loadability: "44" },
    ]);
    expect([...map.entries()]).toEqual([
      ["A", 120],
      ["C", 44],
    ]);
  });
});
