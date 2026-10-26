import { HttpException } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import { LoadListStatus } from "./load-list.entity";
import {
  clientActor,
  Harness,
  makeHarness,
  opsActor,
  seedLine,
  useControlledClock,
} from "./testing/ready-to-ship-harness";
import type { ReadyToShipView } from "./ready-to-ship.types";

const HEADERS = [
  "Container",
  "Container Name",
  "SKU",
  "Description",
  "Quantity",
  "Load Factor",
  "Proforma (PI)",
  "Name",
  "SO",
  "Confirmed",
];

/** A file in the export's own layout: rows of [container, sku, qty, pi, so]. */
async function xlsx(
  rows: [string | number | null, string, unknown, string, string][],
): Promise<{ buffer: Buffer; originalname: string }> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Ready to ship");
  sheet.addRow(HEADERS);
  for (const [container, sku, qty, pi, so] of rows) {
    sheet.addRow([container, null, sku, "desc", qty, null, pi, null, so, null]);
  }
  return {
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    originalname: "load list.xlsx",
  };
}

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 0, code: "no error" }) as Record<string, unknown>,
    (e: unknown) => {
      const body = (e as HttpException).getResponse() as Record<
        string,
        unknown
      >;
      return { status: (e as HttpException).getStatus(), ...body } as Record<
        string,
        unknown
      >;
    },
  );

/**
 * Phase 25 — a load list uploaded as Excel (the export's format).
 *
 * Line A: 150 units (PI 100000001, SKU AAA, SO 300029159), 100 per container.
 * Line B: 100 units (PI 100000002, SKU BBB), 100 per container.
 * Line N: 30 units without loadability (OK to mix only).
 * Line X: on an archived card.
 */
describe("Load list Excel upload (Phase 25)", () => {
  let h: Harness;
  let clock: ReturnType<typeof useControlledClock>;

  beforeEach(async () => {
    clock = useControlledClock();
    h = makeHarness({ loadListStatus: LoadListStatus.DRAFT_CEAT });
    seedLine(h, {
      id: "li-A",
      piNumber: "100000001",
      materialNum: "AAA",
      dispatchQty: "150",
    });
    seedLine(h, {
      id: "li-B",
      piNumber: "100000002",
      materialNum: "BBB",
      dispatchQty: "100",
    });
    seedLine(h, {
      id: "li-N",
      piNumber: "100000003",
      materialNum: "NNN",
      dispatchQty: "30",
      loadability: null,
    });
    seedLine(h, {
      id: "li-X",
      piNumber: "100000009",
      materialNum: "XXX",
      archived: true,
    });
    await h.service.getView(opsActor, "cust-1"); // slots 1-3 + OK to mix
  });

  afterEach(() => clock.restore());

  const placement = (view: ReadyToShipView) =>
    view.containers
      .filter((c) => c.allocations.length > 0)
      .map((c) => [
        c.label,
        c.allocations
          .map((a) => `${a.materialNum}:${a.allocatedQty}`)
          .join(","),
      ]);
  const opsImport = async (
    file: { buffer: Buffer; originalname: string },
    confirm = false,
  ) => h.loadListService.importXlsx(opsActor, file, confirm, "cust-1");

  it("a valid file replaces the layout in one go — and one 'undo' brings the old one back", async () => {
    clock.tick();
    const before = await h.service.move(
      {
        piLineItemId: "li-B",
        containerId: h.containers.rows[2].id as string,
        qty: 40,
      },
      opsActor,
      "cust-1",
    );
    expect(placement(before)).toEqual([["Контейнер 3", "BBB:40"]]);
    clock.tick();

    const view = await opsImport(
      await xlsx([
        [1, "AAA", 100, "100000001", "300029159"],
        [2, "AAA", 50, "100000001", "300029159"],
        [2, "BBB", 50, "100000002", "300029159"],
        ["OK to mix", "NNN", 30, "100000003", "300029159"],
        [null, "BBB", 50, "100000002", "300029159"], // unplaced remainder: ignored
      ]),
    );

    expect(placement(view)).toEqual([
      ["Контейнер 1", "AAA:100"],
      ["Контейнер 2", "AAA:50,BBB:50"],
      ["OK to mix", "NNN:30"],
    ]);
    expect(h.audit.entries.at(-1)).toMatchObject({
      action: "rts.load_list_imported",
      metadata: { fileName: "load list.xlsx", rowsProcessed: 5, positions: 4 },
      inTransaction: true,
    });

    clock.tick();
    const undone = await h.service.undoLast(opsActor, "cust-1");
    expect(placement(undone)).toEqual([["Контейнер 3", "BBB:40"]]);
  });

  it("a file with any error isn't applied at all; the report names each bad row", async () => {
    clock.tick();
    await h.service.move(
      {
        piLineItemId: "li-B",
        containerId: h.containers.rows[2].id as string,
        qty: 40,
      },
      opsActor,
      "cust-1",
    );
    const allocationsBefore = JSON.stringify(h.allocations.rows);

    const result = await failure(
      opsImport(
        await xlsx([
          [1, "AAA", 100, "100000001", "300029159"], // row 2: fine
          [1, "AAA", "ten", "100000001", "300029159"], // row 3: not a number
          [1, "ZZZ", 5, "100000001", "300029159"], // row 4: unknown line
          [2, "XXX", 5, "100000009", "300029159"], // row 5: archived card
          [2, "AAA", 60, "100000001", "300029159"], // row 6: A = 160 > 150
          [3, "BBB", 101, "100000002", "300029159"], // row 7: BBB 101 > 100
          [3, "NNN", 1, "100000003", "300029159"], // row 8: no loadability outside OK to mix
          ["Склад", "BBB", 1, "100000002", "300029159"], // row 9: no such container
          [1, "AAA", 1.5, "100000001", "300029159"], // row 10: not whole
        ]),
      ),
    );

    expect(result).toMatchObject({ status: 400, code: "IMPORT_INVALID" });
    expect(
      (result.details as { row?: number; code: string }[]).map((d) => [
        d.row,
        d.code,
      ]),
    ).toEqual([
      [3, "IMPORT_BAD_QUANTITY"],
      [4, "IMPORT_UNKNOWN_LINE"],
      [5, "IMPORT_ARCHIVED_PI"],
      [6, "IMPORT_EXCEEDS_AVAILABLE"],
      [7, "IMPORT_EXCEEDS_AVAILABLE"],
      [8, "IMPORT_NO_LOADABILITY"],
      [9, "IMPORT_UNKNOWN_CONTAINER"],
      [10, "IMPORT_BAD_QUANTITY"],
    ]);
    expect(JSON.stringify(h.allocations.rows)).toBe(allocationsBefore);
    expect(h.audit.actions()).not.toContain("rts.load_list_imported");
  });

  it("over 100% and no loadability are reported per container / row", async () => {
    const result = await failure(
      opsImport(
        await xlsx([
          [1, "AAA", 100, "100000001", "300029159"],
          [1, "BBB", 30, "100000002", "300029159"], // C1: 130%
          [2, "NNN", 5, "100000003", "300029159"], // no loadability
        ]),
      ),
    );

    expect(result.details).toEqual([
      {
        code: "IMPORT_CONTAINER_OVERFILLED",
        row: 2,
        params: { container: "1", percent: 130 },
      },
      {
        code: "IMPORT_NO_LOADABILITY",
        row: 4,
        params: { container: "2", piNumber: "100000003", materialNum: "NNN" },
      },
    ]);
  });

  it("confirmed positions must stay exactly as they are", async () => {
    clock.tick();
    await h.service.move(
      {
        piLineItemId: "li-A",
        containerId: h.containers.rows[0].id as string,
        qty: 100,
      },
      opsActor,
      "cust-1",
    );
    await h.confirm(opsActor); // C1 = A 100, confirmed
    h.setLoadListStatus(LoadListStatus.DRAFT_CEAT);

    const changed = await failure(
      opsImport(await xlsx([[1, "AAA", 90, "100000001", "300029159"]])),
    );
    expect(changed.details).toEqual([
      expect.objectContaining({
        code: "IMPORT_CONFIRMED_CHANGED",
        row: 2,
        params: expect.objectContaining({ confirmed: 100, file: 90 }),
      }),
    ]);
    const dropped = await failure(
      opsImport(await xlsx([[2, "AAA", 50, "100000001", "300029159"]])),
    );
    expect((dropped.details as { code: string }[]).map((d) => d.code)).toEqual([
      "IMPORT_CONFIRMED_CHANGED",
    ]);
    const intoLocked = await failure(
      opsImport(
        await xlsx([
          [1, "AAA", 100, "100000001", "300029159"],
          [1, "BBB", 1, "100000002", "300029159"],
        ]),
      ),
    );
    expect(
      (intoLocked.details as { code: string }[]).map((d) => d.code),
    ).toEqual(["IMPORT_CONTAINER_LOCKED"]);

    // Kept as it is plus new rows elsewhere: fine.
    const ok = await opsImport(
      await xlsx([
        [1, "AAA", 100, "100000001", "300029159"],
        [2, "AAA", 50, "100000001", "300029159"],
      ]),
    );
    expect(placement(ok)).toEqual([
      ["Контейнер 1", "AAA:100"],
      ["Контейнер 2", "AAA:50"],
    ]);
  });

  it("ops: a numbered container that doesn't exist is created as a manual one — only after confirmation", async () => {
    const file = await xlsx([[7, "BBB", 10, "100000002", "300029159"]]);

    const asked = await failure(opsImport(file));
    expect(asked).toMatchObject({
      status: 400,
      code: "IMPORT_CONFIRM_NEW_CONTAINERS",
      params: { count: 1, containers: "7" },
    });
    expect(h.containers.rows.some((c) => c.label === "Контейнер 7")).toBe(
      false,
    );

    const view = await opsImport(file, true);
    expect(
      view.containers.find((c) => c.label === "Контейнер 7"),
    ).toMatchObject({
      isManual: true,
      totalQty: 10,
    });
  });

  it("the client: only while editing, and never a new container", async () => {
    const file = await xlsx([[1, "BBB", 10, "100000002", "300029159"]]);
    expect(
      await failure(h.loadListService.importXlsx(clientActor, file, false)),
    ).toMatchObject({ status: 400, code: "LOAD_LIST_NOT_EDITABLE" });

    h.setLoadListStatus(LoadListStatus.CLIENT_EDITING);
    const unknown = await failure(
      h.loadListService.importXlsx(
        clientActor,
        await xlsx([[7, "BBB", 10, "100000002", "300029159"]]),
        true,
      ),
    );
    expect(unknown.details).toEqual([
      { code: "IMPORT_UNKNOWN_CONTAINER", row: 2, params: { container: "7" } },
    ]);
    const view = await h.loadListService.importXlsx(clientActor, file, false);
    expect(placement(view)).toEqual([["Контейнер 1", "BBB:10"]]);
    // And ops can't upload while the client edits.
    expect(await failure(opsImport(file))).toMatchObject({
      code: "LOAD_LIST_NOT_EDITABLE",
    });
  });

  it("the export's own file goes back in unchanged (round trip)", async () => {
    clock.tick();
    await h.service.move(
      {
        piLineItemId: "li-A",
        containerId: h.containers.rows[1].id as string,
        qty: 70,
      },
      opsActor,
      "cust-1",
    );
    const exported = await h.service.exportXlsx(opsActor, "cust-1");

    const view = await opsImport({
      buffer: exported.buffer,
      originalname: exported.fileName,
    });

    expect(placement(view)).toEqual([["Контейнер 2", "AAA:70"]]);
  });

  it("not the export's layout: IMPORT_FILE_UNREADABLE", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Sheet1").addRow(["foo", "bar"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    expect(
      await failure(opsImport({ buffer, originalname: "x.xlsx" })),
    ).toMatchObject({
      status: 400,
      code: "IMPORT_FILE_UNREADABLE",
    });
    expect(
      await failure(
        opsImport({
          buffer: Buffer.from("not a workbook"),
          originalname: "x.xlsx",
        }),
      ),
    ).toMatchObject({ code: "IMPORT_FILE_UNREADABLE" });
  });
});
