import * as ExcelJS from "exceljs";
import { parseBackorderFile } from "./parse-backorder-file";

const BO_HEADERS = [
  "Customer Code",
  "Customer Name",
  "SalesOrderNum",
  "MaterialNum",
  "MaterialDesc",
  "Balance To be Delivered",
  "Quotation",
  "Port Name",
  "Proforma from Date",
  "Quantity",
  "Purchase Order",
  "MT",
  "Load Factor",
  "Radial Load.Loadability",
  "Current Week Dispatch Plan (MT)",
  "Current Week Dispatch Plan (Load Factor)",
  "Current Week Dispatch Plan (Qty)",
];

async function buildWorkbook(
  sheets: Record<string, { headerRow: 1 | 2; rows: unknown[][] }>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const [name, { headerRow, rows }] of Object.entries(sheets)) {
    const sheet = workbook.addWorksheet(name);
    if (headerRow === 2) {
      sheet.addRow([66000402]); // the stray customer-code row seen on "Radial BO"
    }
    sheet.addRow(BO_HEADERS);
    for (const row of rows) {
      sheet.addRow(row);
    }
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe("parseBackorderFile", () => {
  it("parses rows from both Radial BO and Bias BO, ignoring other sheets", async () => {
    const buffer = await buildWorkbook({
      Summary: { headerRow: 1, rows: [] },
      "Radial BO": {
        headerRow: 2,
        rows: [
          [
            66000402,
            'MTK ROSBERG LLC "INR"',
            300029159,
            "107071",
            "VF710/70R42 CFO TORQUEMAX 185D TL SB",
            2,
            100037320,
            "Novorossiysk",
            "2026-06-16",
            2,
            100035801,
            0.699686,
            0.0909090909,
            22,
            0.70037,
            0.0909090909,
            2,
          ],
        ],
      },
      "Bias BO": {
        headerRow: 1,
        rows: [
          [
            66000402,
            'MTK ROSBERG LLC "INR"',
            300028932,
            "102702",
            "18.4-34 / 12PR FARMAX TT",
            10,
            100037320,
            "Novorossiysk",
            "2026-05-05",
            10,
            "Email date 05May2026",
            0.96821,
            0.16129032258064516,
            62,
            0.96821,
            0.16129032258064516,
            10,
          ],
        ],
      },
      "ETD-ETA": { headerRow: 1, rows: [["should be ignored entirely"]] },
    });

    const { rows, skippedRowCount } = await parseBackorderFile(buffer);

    expect(rows).toHaveLength(2);
    expect(skippedRowCount).toBe(0);
    expect(rows.every((r) => r.piNumber === "100037320")).toBe(true);
    const radialRow = rows.find((r) => r.materialNum === "107071")!;
    expect(radialRow.soNumber).toBe("300029159");
    expect(radialRow.balanceToBeDelivered).toBe(2);
    expect(radialRow.quantity).toBe(2);
    expect(radialRow.loadability).toBe(22);
    expect(radialRow.loadFactor).toBeCloseTo(0.0909090909);
    expect(radialRow.currentWeekDispatchQty).toBe(2);
  });

  it("finds the header row regardless of whether a stray row precedes it", async () => {
    const bufferWithOffset = await buildWorkbook({
      "Radial BO": {
        headerRow: 2,
        rows: [
          [
            66000402,
            "Cust",
            1,
            "M1",
            "Desc",
            1,
            100099999,
            "Port",
            "2026-01-01",
            1,
            "PO",
            0.1,
            0.1,
            10,
            0,
            0,
            0,
          ],
        ],
      },
    });
    const bufferNoOffset = await buildWorkbook({
      "Bias BO": {
        headerRow: 1,
        rows: [
          [
            66000402,
            "Cust",
            1,
            "M1",
            "Desc",
            1,
            100099999,
            "Port",
            "2026-01-01",
            1,
            "PO",
            0.1,
            0.1,
            10,
            0,
            0,
            0,
          ],
        ],
      },
    });

    expect((await parseBackorderFile(bufferWithOffset)).rows[0].piNumber).toBe(
      "100099999",
    );
    expect((await parseBackorderFile(bufferNoOffset)).rows[0].piNumber).toBe(
      "100099999",
    );
  });

  it("skips a fully blank/footer row silently — not counted as an invalid row", async () => {
    const buffer = await buildWorkbook({
      "Bias BO": {
        headerRow: 1,
        rows: [
          [
            66000402,
            "Cust",
            1,
            "M1",
            "Desc",
            1,
            100099999,
            "Port",
            "2026-01-01",
            1,
            "PO",
            0.1,
            0.1,
            10,
            0,
            0,
            0,
          ],
          [], // trailing blank row — not real data, doesn't count as "skipped"
        ],
      },
    });

    const { rows, skippedRowCount } = await parseBackorderFile(buffer);
    expect(rows).toHaveLength(1);
    expect(skippedRowCount).toBe(0);
  });

  it("counts a row with a material number but no readable PI number as skipped", async () => {
    const buffer = await buildWorkbook({
      "Bias BO": {
        headerRow: 1,
        rows: [
          [
            66000402,
            "Cust",
            1,
            "M1",
            "Desc",
            1,
            100099999,
            "Port",
            "2026-01-01",
            1,
            "PO",
            0.1,
            0.1,
            10,
            0,
            0,
            0,
          ],
          [
            66000402,
            "Cust",
            2,
            "M2", // has a material number...
            "Desc",
            1,
            null, // ...but Quotation/PI number is unreadable
            "Port",
            "2026-01-01",
            1,
            "PO",
            0.1,
            0.1,
            10,
            0,
            0,
            0,
          ],
        ],
      },
    });

    const { rows, skippedRowCount } = await parseBackorderFile(buffer);
    expect(rows).toHaveLength(1);
    expect(skippedRowCount).toBe(1);
  });

  it("returns nothing when neither target sheet is present", async () => {
    const buffer = await buildWorkbook({
      Summary: { headerRow: 1, rows: [] },
      "ETD-ETA": { headerRow: 1, rows: [] },
    });
    const result = await parseBackorderFile(buffer);
    expect(result.rows).toEqual([]);
    expect(result.skippedRowCount).toBe(0);
  });
});
