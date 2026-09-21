import * as ExcelJS from "exceljs";
import { buildBackorderExportWorkbook } from "./build-backorder-export-workbook";
import { ProformaInvoice } from "../../proforma-invoices/proforma-invoice.entity";
import { PiLineItem } from "../../pi-line-items/pi-line-item.entity";

function makeLineItem(overrides: Partial<PiLineItem>): PiLineItem {
  return Object.assign(new PiLineItem(), {
    soNumber: null,
    materialNum: null,
    materialDesc: null,
    balanceToBeDelivered: null,
    quantity: null,
    mt: null,
    loadFactor: null,
    loadability: null,
    currentWeekDispatchLoadFactor: null,
    currentWeekDispatchQty: null,
    ...overrides,
  });
}

function makePi(overrides: Partial<ProformaInvoice>): ProformaInvoice {
  return Object.assign(new ProformaInvoice(), {
    piNumber: "100037320",
    totalQty: null,
    qtyPending: null,
    totalContainers: null,
    containersPending: null,
    currentWeekPlanContainers: null,
    currentWeekPlanQty: null,
    isArchivedShipped: false,
    pendingReplacementFileUrl: null,
    signedFileUrl: null,
    piFileUrl: null,
    lineItems: [],
    ...overrides,
  });
}

async function readWorkbookRows(
  workbook: ExcelJS.Workbook,
): Promise<unknown[][]> {
  const buffer = await workbook.xlsx.writeBuffer();
  const readBack = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await readBack.xlsx.load(buffer as any);
  const sheet = readBack.worksheets[0];
  const rows: unknown[][] = [];
  sheet.eachRow((row) => rows.push(row.values as unknown[]));
  return rows;
}

describe("buildBackorderExportWorkbook", () => {
  it("writes both dates in the header and one row per line item", async () => {
    const pi = makePi({
      piNumber: "100037320",
      lineItems: [
        makeLineItem({ materialNum: "A", quantity: "2.00" }),
        makeLineItem({ materialNum: "B", quantity: "4.00" }),
      ],
    });

    const workbook = buildBackorderExportWorkbook(
      [pi],
      new Date("2026-09-01T15:51:00Z"),
      new Date("2026-09-03T10:00:00Z"),
    );
    const rows = await readWorkbookRows(workbook);

    expect(rows[0][1]).toBe("Бэкордер от 2026-09-01");
    expect(rows[1][1]).toBe("Выгружено: 2026-09-03");

    // exceljs's eachRow skips fully-blank rows, so index arithmetic off the
    // start is fragile — locate the column-header row by content instead.
    const columnHeaderIndex = rows.findIndex((r) => r[1] === "PI Number");
    const dataRows = rows.slice(columnHeaderIndex + 1);
    expect(dataRows).toHaveLength(2);
    expect(dataRows[0].slice(1, 4)).toEqual(["100037320", pi.status, "A"]);
    expect(dataRows[1].slice(1, 4)).toEqual(["100037320", pi.status, "B"]);
  });

  it("adds Priority Qty / Priority Load Factor after the existing columns, dashes where there is no priority", async () => {
    const pi1 = makePi({
      piNumber: "100037320",
      lineItems: [
        makeLineItem({
          materialNum: "A",
          loadability: "200",
          priorityQty: "40.00",
        }),
        makeLineItem({
          materialNum: "B",
          loadability: "100",
          priorityQty: "0.00",
        }),
        makeLineItem({
          materialNum: "C",
          loadability: null,
          priorityQty: "25.00",
        }),
      ],
    });
    const pi2 = makePi({
      piNumber: "100037321",
      lineItems: [
        makeLineItem({
          materialNum: "D",
          loadability: "3",
          priorityQty: "1.00",
        }),
        makeLineItem({ materialNum: "E", loadability: "50", priorityQty: "0" }),
      ],
    });

    const rows = await readWorkbookRows(
      buildBackorderExportWorkbook(
        [pi1, pi2],
        new Date("2026-09-01T00:00:00Z"),
        new Date("2026-09-03T00:00:00Z"),
      ),
    );

    const headerRow = rows.find((r) => r[1] === "PI Number")!;
    expect(headerRow.slice(1)).toHaveLength(14);
    expect(headerRow.slice(12)).toEqual([
      "Current Week Dispatch Qty",
      "Priority Qty",
      "Priority Load Factor",
    ]);
    const priorityOf = (material: string) =>
      rows.find((r) => r[3] === material)!.slice(13);
    expect(priorityOf("A")).toEqual([40, 0.2]);
    expect(priorityOf("B")).toEqual(["—", "—"]);
    expect(priorityOf("C")).toEqual([25, "—"]);
    expect(priorityOf("D")).toEqual([1, 0.3333]);
    expect(priorityOf("E")).toEqual(["—", "—"]);
  });

  it("falls back to a dash when there has never been an upload", async () => {
    const workbook = buildBackorderExportWorkbook(
      [],
      null,
      new Date("2026-09-03T10:00:00Z"),
    );
    const rows = await readWorkbookRows(workbook);
    expect(rows[0][1]).toBe("Бэкордер от —");
  });

  it("only includes line items from the PIs it's given (caller is responsible for filtering archived ones)", async () => {
    const active = makePi({
      piNumber: "100037320",
      lineItems: [makeLineItem({ materialNum: "ACTIVE" })],
    });

    const workbook = buildBackorderExportWorkbook(
      [active],
      new Date("2026-09-01T00:00:00Z"),
      new Date("2026-09-03T00:00:00Z"),
    );
    const rows = await readWorkbookRows(workbook);
    const columnHeaderIndex = rows.findIndex((r) => r[1] === "PI Number");
    const dataRows = rows.slice(columnHeaderIndex + 1);
    expect(dataRows).toHaveLength(1);
    expect(dataRows[0][3]).toBe("ACTIVE");
  });
});
