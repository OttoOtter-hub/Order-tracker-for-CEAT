import { Harness, makeHarness } from "./testing/ready-to-ship-harness";

function oldItem(id: string, materialNum: string, soNumber = "SO-1") {
  return { id, materialNum, soNumber } as any;
}

describe("AllocationRelinkService", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    h.containers.seed({
      id: "c-1",
      customer: { id: "cust-1" },
      label: "Контейнер 1",
      isConfirmed: true,
    } as any);
  });

  function seedAllocation(id: string, lineId: string, qty = "10") {
    h.allocations.seed({
      id,
      container: { id: "c-1" },
      piLineItem: { id: lineId },
      allocatedQty: qty,
    } as any);
    h.actions.seed({
      id: `act-${id}`,
      customer: { id: "cust-1" },
      container: { id: "c-1" },
      piLineItem: { id: lineId },
      deltaQty: qty,
    } as any);
  }

  it("re-points allocations, their undo log and leaves marking files attached, matching by material + sales order", async () => {
    seedAllocation("al-1", "old-1");
    h.markings.seed({ id: "m-1", allocation: { id: "al-1" } } as any);

    await h.relink.relink(
      [oldItem("old-1", "MAT-1")],
      [oldItem("new-1", "MAT-1")],
    );

    expect(h.allocations.rows[0].piLineItem).toEqual({ id: "new-1" });
    expect(h.actions.rows[0].piLineItem).toEqual({ id: "new-1" });
    expect(h.allocations.rows[0].allocatedQty).toBe("10");
    expect(h.markings.rows).toHaveLength(1);
  });

  it("does not match rows that differ in sales order number", async () => {
    seedAllocation("al-1", "old-1");

    await h.relink.relink(
      [oldItem("old-1", "MAT-1", "SO-1")],
      [oldItem("new-1", "MAT-1", "SO-2")],
    );

    expect(h.allocations.rows).toHaveLength(0);
  });

  it("removes allocations, actions and marking files of a line that is gone from the new snapshot", async () => {
    seedAllocation("al-gone", "old-gone");
    seedAllocation("al-kept", "old-kept");
    h.markings.seed({ id: "m-gone", allocation: { id: "al-gone" } } as any);
    h.markings.seed({ id: "m-kept", allocation: { id: "al-kept" } } as any);

    await h.relink.relink(
      [oldItem("old-gone", "MAT-GONE"), oldItem("old-kept", "MAT-KEPT")],
      [oldItem("new-kept", "MAT-KEPT")],
    );

    expect(h.allocations.rows.map((a) => a.id)).toEqual(["al-kept"]);
    expect(h.actions.rows.map((a) => a.id)).toEqual(["act-al-kept"]);
    expect(h.markings.rows.map((m) => m.id)).toEqual(["m-kept"]);
  });

  it("pairs duplicate-key rows one-to-one so two old rows never collapse onto one new row", async () => {
    seedAllocation("al-1", "old-1");
    seedAllocation("al-2", "old-2");

    await h.relink.relink(
      [oldItem("old-1", "MAT-1"), oldItem("old-2", "MAT-1")],
      [oldItem("new-1", "MAT-1"), oldItem("new-2", "MAT-1")],
    );

    expect(h.allocations.rows.map((a) => a.piLineItem.id).sort()).toEqual([
      "new-1",
      "new-2",
    ]);
  });

  it("keeps each allocation of a repeated key on the row with the same dispatch/balance, even when the new file lists the rows in the other order", async () => {
    const row = (id: string, dispatch: string, balance: string) =>
      ({
        id,
        materialNum: "114699",
        soNumber: "300028280",
        currentWeekDispatchQty: dispatch,
        balanceToBeDelivered: balance,
      }) as any;
    seedAllocation("al-5", "old-5", "3");
    seedAllocation("al-13", "old-13", "4");
    h.markings.seed({ id: "m-13", allocation: { id: "al-13" } } as any);

    await h.relink.relink(
      [row("old-5", "0.00", "5.00"), row("old-13", "0.00", "13.00")],
      [row("new-13", "0", "13"), row("new-5", "0", "5")],
    );

    const lineOf = (allocationId: string) =>
      h.allocations.rows.find((a) => a.id === allocationId)!.piLineItem.id;
    expect(lineOf("al-5")).toBe("new-5");
    expect(lineOf("al-13")).toBe("new-13");
    expect(h.actions.rows.find((a) => a.id === "act-al-5")!.piLineItem).toEqual(
      { id: "new-5" },
    );
    expect(h.markings.rows.map((m) => m.allocation.id)).toEqual(["al-13"]);
  });

  it("still pairs a repeated key by order when the numbers don't tell the rows apart", async () => {
    const row = (id: string) =>
      ({
        id,
        materialNum: "113646",
        soNumber: "300028280",
        currentWeekDispatchQty: "1",
        balanceToBeDelivered: "1",
      }) as any;
    seedAllocation("al-1", "old-1");
    seedAllocation("al-2", "old-2");

    await h.relink.relink(
      [row("old-1"), row("old-2")],
      [row("new-1"), row("new-2")],
    );

    expect(h.allocations.rows.map((a) => a.piLineItem.id).sort()).toEqual([
      "new-1",
      "new-2",
    ]);
  });

  it("does nothing when no allocation points at the old rows", async () => {
    await h.relink.relink(
      [oldItem("old-1", "MAT-1")],
      [oldItem("new-1", "MAT-1")],
    );

    expect(h.allocations.save).not.toHaveBeenCalled();
    expect(h.allocations.delete).not.toHaveBeenCalled();
  });

  it("does not open a transaction for a brand-new card with no old rows", async () => {
    await h.relink.relink([], [oldItem("new-1", "MAT-1")]);

    expect(h.dataSource.transaction).not.toHaveBeenCalled();
  });
});
