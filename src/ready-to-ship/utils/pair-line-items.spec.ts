import { PairableLineItem, pairLineItems } from "./pair-line-items";

function item(
  id: string,
  material: string,
  dispatch: string | null,
  balance: string | null,
  so = "SO-1",
): PairableLineItem {
  return {
    id,
    materialNum: material,
    soNumber: so,
    currentWeekDispatchQty: dispatch,
    balanceToBeDelivered: balance,
  };
}

const pairs = (map: Map<string, string | null>) => Object.fromEntries(map);

describe("pairLineItems", () => {
  it("pairs a single old row with a single new row of the same key even when the numbers changed between weeks", () => {
    const result = pairLineItems(
      [item("old", "M1", "10.00", "50.00")],
      [item("new", "M1", "3", "20")],
    );

    expect(pairs(result)).toEqual({ old: "new" });
  });

  it("maps to null when the key is gone, and never matches across sales orders", () => {
    const result = pairLineItems(
      [
        item("gone", "M1", "1", "1", "SO-1"),
        item("other-so", "M2", "1", "1", "SO-1"),
      ],
      [item("new", "M2", "1", "1", "SO-2")],
    );

    expect(pairs(result)).toEqual({ gone: null, "other-so": null });
  });

  it("keeps each row of a repeated key on the row with the same (dispatch, balance), whatever the order", () => {
    // The real case: PI 100037116 / material 114699 — two rows, balances 5 and 13.
    const result = pairLineItems(
      [
        item("old-5", "114699", "0.00", "5.00"),
        item("old-13", "114699", "0.00", "13.00"),
      ],
      [item("new-13", "114699", "0", "13"), item("new-5", "114699", "0", "5")],
    );

    expect(pairs(result)).toEqual({ "old-5": "new-5", "old-13": "new-13" });
  });

  it("matches on dispatch as well as balance", () => {
    const result = pairLineItems(
      [
        item("old-a", "M1", "2.00", "10.00"),
        item("old-b", "M1", "7.00", "10.00"),
      ],
      [item("new-b", "M1", "7", "10"), item("new-a", "M1", "2", "10")],
    );

    expect(pairs(result)).toEqual({ "old-a": "new-a", "old-b": "new-b" });
  });

  it("compares numbers, not strings: '5.00' equals '5', and missing values equal each other", () => {
    const result = pairLineItems(
      [item("old-1", "M1", null, "5.00"), item("old-2", "M1", null, null)],
      [item("new-none", "M1", null, null), item("new-5", "M1", null, "5")],
    );

    expect(pairs(result)).toEqual({ "old-1": "new-5", "old-2": "new-none" });
  });

  it("falls back to order between rows that share a signature (they're interchangeable)", () => {
    const result = pairLineItems(
      [
        item("old-1", "113646", "1.00", "1.00"),
        item("old-2", "113646", "1.00", "1.00"),
      ],
      [item("new-1", "113646", "1", "1"), item("new-2", "113646", "1", "1")],
    );

    expect(pairs(result)).toEqual({ "old-1": "new-1", "old-2": "new-2" });
  });

  it("pairs what is left by order after the signature matches are taken", () => {
    const result = pairLineItems(
      [item("old-5", "M1", "0", "5"), item("old-13", "M1", "0", "13")],
      [item("new-13", "M1", "0", "13"), item("new-99", "M1", "0", "99")],
    );

    // old-13 keeps its exact twin; old-5 gets the remaining new row.
    expect(pairs(result)).toEqual({ "old-13": "new-13", "old-5": "new-99" });
  });

  it("with fewer new rows than old ones, the exact match survives and the other old row maps to null", () => {
    const result = pairLineItems(
      [item("old-5", "M1", "0", "5"), item("old-13", "M1", "0", "13")],
      [item("new-13", "M1", "0", "13")],
    );

    expect(pairs(result)).toEqual({ "old-13": "new-13", "old-5": null });
  });

  it("is one-to-one: two old rows never share a new row", () => {
    const result = pairLineItems(
      [
        item("o1", "M1", "1", "1"),
        item("o2", "M1", "9", "9"),
        item("o3", "M1", "1", "1"),
      ],
      [item("n1", "M1", "1", "1"), item("n2", "M1", "5", "5")],
    );

    const targets = [...result.values()].filter((v) => v !== null);
    expect(new Set(targets).size).toBe(targets.length);
    // o1 takes its exact twin n1; the leftovers (o2, o3) then take the
    // remaining new rows in order — n2 for o2, nothing left for o3.
    expect(pairs(result)).toEqual({ o1: "n1", o2: "n2", o3: null });
  });

  it("pairs each key independently", () => {
    const result = pairLineItems(
      [item("a-old", "A", "1", "1"), item("b-old", "B", "2", "2")],
      [item("b-new", "B", "2", "2"), item("a-new", "A", "1", "1")],
    );

    expect(pairs(result)).toEqual({ "a-old": "a-new", "b-old": "b-new" });
  });
});
