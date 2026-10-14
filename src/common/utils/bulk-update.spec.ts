import { makeFakeDataSource } from "../testing/fake-data-source";
import { makeFakeRepo } from "../testing/fake-repo";
import { ContainerLineAllocation } from "../../ready-to-ship/container-line-allocation.entity";
import { ProformaInvoice } from "../../proforma-invoices/proforma-invoice.entity";
import { bulkUpdateById } from "./bulk-update";

describe("bulkUpdateById", () => {
  function setup() {
    const allocations = makeFakeRepo();
    const cards = makeFakeRepo();
    const ds = makeFakeDataSource(
      new Map<unknown, unknown>([
        [ContainerLineAllocation, allocations],
        [ProformaInvoice, cards],
      ]),
    );
    return { allocations, cards, ds, em: ds.manager as any };
  }

  it("one UPDATE … FROM (VALUES …) with typed placeholders, a relation by its join column, updated_at bumped", async () => {
    const { allocations, ds, em } = setup();
    allocations.seed({ id: "a-1", piLineItem: { id: "old-1" } } as any);
    allocations.seed({ id: "a-2", piLineItem: { id: "old-2" } } as any);

    await bulkUpdateById(em, ContainerLineAllocation, [
      { id: "a-1", values: { piLineItem: "new-1" } },
      { id: "a-2", values: { piLineItem: "new-2" } },
    ]);

    expect(ds.queries).toEqual([
      {
        sql:
          'UPDATE "container_line_allocations" AS t SET "pi_line_item_id" = v."pi_line_item_id", "updated_at" = now() ' +
          'FROM (VALUES ($1::uuid, $2::uuid), ($3::uuid, $4::uuid)) AS v("id", "pi_line_item_id") ' +
          'WHERE t."id" = v."id"',
        params: ["a-1", "new-1", "a-2", "new-2"],
      },
    ]);
    expect(allocations.rows.map((r) => r.piLineItem)).toEqual([
      { id: "new-1" },
      { id: "new-2" },
    ]);
  });

  it("several columns with their own types; nothing sent for no rows", async () => {
    const { cards, ds, em } = setup();
    cards.seed({ id: "p-1", qtyPending: "5", isArchivedShipped: false } as any);

    await bulkUpdateById(em, ProformaInvoice, []);
    await bulkUpdateById(em, ProformaInvoice, [
      { id: "p-1", values: { qtyPending: "0", isArchivedShipped: true } },
    ]);

    expect(ds.queries).toHaveLength(1);
    expect(ds.queries[0].sql).toContain(
      'VALUES ($1::uuid, $2::numeric, $3::boolean)) AS v("id", "qty_pending", "is_archived_shipped")',
    );
    expect(cards.rows[0]).toMatchObject({
      qtyPending: "0",
      isArchivedShipped: true,
    });
  });

  it("splits more than 500 rows into several statements", async () => {
    const { ds, em } = setup();
    const rows = Array.from({ length: 1201 }, (_, i) => ({
      id: `a-${i}`,
      values: { piLineItem: `n-${i}` },
    }));

    await bulkUpdateById(em, ContainerLineAllocation, rows);

    expect(ds.queries.map((q) => q.params.length)).toEqual([1000, 1000, 402]);
  });

  it("refuses a property that is no column, and rows that don't all set the same properties", async () => {
    const { em } = setup();

    await expect(
      bulkUpdateById(em, ContainerLineAllocation, [
        { id: "a-1", values: { nonsense: 1 } },
      ]),
    ).rejects.toThrow(/no column/);
    await expect(
      bulkUpdateById(em, ProformaInvoice, [
        { id: "p-1", values: { qtyPending: "1", totalQty: "2" } },
        { id: "p-2", values: { qtyPending: "1" } },
      ]),
    ).rejects.toThrow(/lacks totalQty/);
  });
});
