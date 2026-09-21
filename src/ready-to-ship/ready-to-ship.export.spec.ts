import * as ExcelJS from "exceljs";
import { BadRequestException } from "@nestjs/common";
import {
  clientActor,
  makeHarness,
  opsActor,
  otherClientActor,
  seedLine,
  type Harness,
} from "./testing/ready-to-ship-harness";

async function sheetRows(buffer: Buffer): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const rows: unknown[][] = [];
  workbook.worksheets[0].eachRow((row) =>
    rows.push((row.values as unknown[]).slice(1)),
  );
  return rows;
}

describe("ReadyToShipService.exportXlsx", () => {
  let h: Harness;

  beforeEach(async () => {
    h = makeHarness();
    seedLine(h, {
      id: "l1",
      piNumber: "100037320",
      piLabel: "Орел",
      materialNum: "M1",
      soNumber: "S1",
      loadability: "50",
      dispatchQty: "100",
    });
    // No loadability: can never be placed, but must still be in the export.
    seedLine(h, {
      id: "l2",
      piNumber: "100037321",
      materialNum: "M2",
      soNumber: "S2",
      loadability: null,
      dispatchQty: "7",
    });
    const view = await h.service.getView(clientActor);
    await h.service.move(
      { piLineItemId: "l1", containerId: view.containers[0].id, qty: 30 },
      clientActor,
    );
  });

  it("client gets the placed part under its container number and the remainder as OK to mix", async () => {
    const { buffer, fileName } = await h.service.exportXlsx(clientActor);

    expect(fileName).toMatch(/^ReadyToShip_\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(await sheetRows(buffer)).toEqual([
      [
        "Контейнер",
        "SKU",
        "Описание",
        "Количество",
        "Load Factor",
        "Проформа (PI)",
        "Название",
        "SO",
      ],
      [1, "M1", "desc l1", 30, 0.6, "100037320", "Орел", "S1"],
      ["OK to mix", "M1", "desc l1", 70, 1.4, "100037320", "Орел", "S1"],
      // a PI without a label -> an empty cell, not "null"
      [
        "OK to mix",
        "M2",
        "desc l2",
        7,
        undefined,
        "100037321",
        undefined,
        "S2",
      ],
    ]);
  });

  it("getView carries the PI label on allocations and on lines, null when a PI has none", async () => {
    const view = await h.service.getView(clientActor);

    expect(view.containers[0].allocations.map((a) => a.piLabel)).toEqual([
      "Орел",
    ]);
    expect(view.unallocatedLines.map((l) => [l.piNumber, l.piLabel])).toEqual([
      ["100037320", "Орел"],
      ["100037321", null],
    ]);
  });

  it("ops gets the same list for the named customer, and must name one", async () => {
    const asClient = await sheetRows(
      (await h.service.exportXlsx(clientActor)).buffer,
    );

    const asOps = await sheetRows(
      (await h.service.exportXlsx(opsActor, "cust-1")).buffer,
    );

    expect(asOps).toEqual(asClient);
    await expect(h.service.exportXlsx(opsActor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("another customer's client gets their own (empty) list, never this one's", async () => {
    const rows = await sheetRows(
      (await h.service.exportXlsx(otherClientActor)).buffer,
    );

    expect(rows).toHaveLength(1);
  });
});
