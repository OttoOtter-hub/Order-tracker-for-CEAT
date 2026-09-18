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

async function readWorkbookRows(workbook: ExcelJS.Workbook): Promise<unknown[][]> {
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
