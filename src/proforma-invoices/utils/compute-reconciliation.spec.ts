import { ActualContainerLineItem } from "../../actual-containers/actual-container-line-item.entity";
import { ContainerLineAllocation } from "../../ready-to-ship/container-line-allocation.entity";
import { PiLineItem } from "../../pi-line-items/pi-line-item.entity";
import { computeReconciliation } from "./compute-reconciliation";

function lineItem(overrides: Partial<PiLineItem>): PiLineItem {
  return Object.assign(new PiLineItem(), {
    soNumber: null,
    materialNum: null,
    materialDesc: null,
    ...overrides,
  });
}

function allocation(
  piLineItem: PiLineItem,
  allocatedQty: string,
  isLocked: boolean,
): ContainerLineAllocation {
  return Object.assign(new ContainerLineAllocation(), {
    piLineItem,
    allocatedQty,
    isLocked,
  });
}

function actualLine(
  materialNum: string | null,
  quantity: string,
): ActualContainerLineItem {
  return Object.assign(new ActualContainerLineItem(), {
    materialNum,
    quantity,
  });
}

describe("computeReconciliation", () => {
  it("groups several SO rows of the same material into one row, summing both sides", () => {
    const so1 = lineItem({ id: "li-1", materialNum: "M1", soNumber: "SO1" });
    const so2 = lineItem({ id: "li-2", materialNum: "M1", soNumber: "SO2" });

    const rows = computeReconciliation(
      [so1, so2],
      [allocation(so1, "10", true), allocation(so2, "5", true)],
      [actualLine("M1", "8"), actualLine("M1", "4")],
    );

    expect(rows).toEqual([
      {
        materialNum: "M1",
        materialDesc: null,
        plannedQty: 15,
        shippedQty: 12,
        delta: -3,
      },
    ]);
  });

  it("computes delta in both directions", () => {
    const overPlanned = lineItem({ id: "li-1", materialNum: "A" });
    const underPlanned = lineItem({ id: "li-2", materialNum: "B" });

    const rows = computeReconciliation(
      [overPlanned, underPlanned],
      [
        allocation(overPlanned, "20", true),
        allocation(underPlanned, "3", true),
      ],
      [actualLine("A", "12"), actualLine("B", "9")],
    );
    const byMaterial = new Map(rows.map((r) => [r.materialNum, r]));

    // planned more than shipped -> negative delta
    expect(byMaterial.get("A")).toMatchObject({
      plannedQty: 20,
      shippedQty: 12,
      delta: -8,
    });
    // shipped more than planned (e.g. a container was unlocked and emptied
    // after an earlier batch had already physically shipped) -> positive delta
    expect(byMaterial.get("B")).toMatchObject({
      plannedQty: 3,
      shippedQty: 9,
      delta: 6,
    });
  });

  it("only counts locked allocations — unlocked ones are ignored", () => {
    const item = lineItem({ id: "li-1", materialNum: "M1" });

    const rows = computeReconciliation(
      [item],
      [
        allocation(item, "10", true), // locked -> counts
        allocation(item, "999", false), // unlocked -> must not count
      ],
      [],
    );

    expect(rows).toEqual([
      {
        materialNum: "M1",
        materialDesc: null,
        plannedQty: 10,
        shippedQty: 0,
        delta: -10,
      },
    ]);
  });

  it("returns a zero row for a material with no allocation and no shipment yet", () => {
    const item = lineItem({
      id: "li-1",
      materialNum: "M1",
      materialDesc: "Tyre",
    });

    const rows = computeReconciliation([item], [], []);

    expect(rows).toEqual([
      {
        materialNum: "M1",
        materialDesc: "Tyre",
        plannedQty: 0,
        shippedQty: 0,
        delta: 0,
      },
    ]);
  });

  it("does not invent a row for an actual line whose material isn't among this PI's own line items", () => {
    const item = lineItem({ id: "li-1", materialNum: "M1" });

    const rows = computeReconciliation(
      [item],
      [],
      [actualLine("M1", "5"), actualLine("SOME-OTHER-MATERIAL", "999")],
    );

    expect(rows).toEqual([
      {
        materialNum: "M1",
        materialDesc: null,
        plannedQty: 0,
        shippedQty: 5,
        delta: 5,
      },
    ]);
  });

  it("skips line items with no material number — nothing to group them by", () => {
    const noMaterial = lineItem({ id: "li-1", materialNum: null });
    const withMaterial = lineItem({ id: "li-2", materialNum: "M1" });

    const rows = computeReconciliation(
      [noMaterial, withMaterial],
      [allocation(noMaterial, "50", true)],
      [],
    );

    expect(rows.map((r) => r.materialNum)).toEqual(["M1"]);
  });

  it("is empty for a card with no line items at all", () => {
    expect(computeReconciliation([], [], [])).toEqual([]);
  });

  it("sorts rows by material number", () => {
    const b = lineItem({ id: "li-1", materialNum: "B" });
    const a = lineItem({ id: "li-2", materialNum: "A" });

    const rows = computeReconciliation([b, a], [], []);

    expect(rows.map((r) => r.materialNum)).toEqual(["A", "B"]);
  });
});
