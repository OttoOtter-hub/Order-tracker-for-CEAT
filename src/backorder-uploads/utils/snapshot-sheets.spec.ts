import * as ExcelJS from "exceljs";
import {
  buildSnapshotWorkbook,
  extractSnapshotSheets,
} from "./snapshot-sheets";

async function roundTrip(
  workbook: ExcelJS.Workbook,
): Promise<ExcelJS.Workbook> {
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(Buffer.from(await workbook.xlsx.writeBuffer()) as any);
  return loaded;
}

describe("snapshot sheets", () => {
  async function sourceWorkbook(): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const summary = workbook.addWorksheet("Summary");
    summary.addRow(["Open Order Summary", null, "Cont."]);
    summary.getCell("D3").value = { formula: "1+2", result: 3 };
    const dispatch = workbook.addWorksheet("Radial Dispatch");
    dispatch.addRow(["Container ID", "PGI Date", "Quantity", "Flag"]);
    const row = dispatch.addRow([
      "CAAU6845690",
      new Date("2026-03-26T00:00:00Z"),
      2,
      true,
    ]);
    row.getCell(2).numFmt = "yyyy-mm-dd";
    // a gap: row 5 is filled while rows 3-4 stay empty
    dispatch.getCell("A5").value = "after the gap";
    workbook.addWorksheet("Empty sheet");
    return workbook;
  }

  it("captures every sheet, keeps row numbers and gaps, skips blank rows", async () => {
    const sheets = extractSnapshotSheets(
      await roundTrip(await sourceWorkbook()),
    );

    expect(sheets.map((s) => [s.sheetName, s.sheetIndex])).toEqual([
      ["Summary", 0],
      ["Radial Dispatch", 1],
      ["Empty sheet", 2],
    ]);
    expect(sheets[1].rows).toEqual([
      { rowIndex: 1, cells: ["Container ID", "PGI Date", "Quantity", "Flag"] },
      {
        rowIndex: 2,
        cells: ["CAAU6845690", { $date: "2026-03-26T00:00:00.000Z" }, 2, true],
      },
      { rowIndex: 5, cells: ["after the gap"] },
    ]);
    expect(sheets[2].rows).toEqual([]);
  });

  it("stores a formula as its cached result and empty cells in the middle of a row as null", async () => {
    const sheets = extractSnapshotSheets(
      await roundTrip(await sourceWorkbook()),
    );

    const summary = sheets[0].rows;
    expect(summary[0].cells).toEqual(["Open Order Summary", null, "Cont."]);
    expect(summary[1]).toEqual({ rowIndex: 3, cells: [null, null, null, 3] });
  });

  it("survives JSON storage (what the jsonb column does to it)", async () => {
    const sheets = extractSnapshotSheets(
      await roundTrip(await sourceWorkbook()),
    );

    expect(JSON.parse(JSON.stringify(sheets))).toEqual(sheets);
  });

  it("rebuilds a workbook with the same sheets, cells and real date cells", async () => {
    const sheets = extractSnapshotSheets(
      await roundTrip(await sourceWorkbook()),
    );

    const rebuilt = await roundTrip(
      buildSnapshotWorkbook(JSON.parse(JSON.stringify(sheets))),
    );

    expect(rebuilt.worksheets.map((s) => s.name)).toEqual([
      "Summary",
      "Radial Dispatch",
      "Empty sheet",
    ]);
    expect(extractSnapshotSheets(rebuilt)).toEqual(sheets);
    const dateCell = rebuilt
      .getWorksheet("Radial Dispatch")!
      .getCell("B2").value;
    expect(dateCell).toBeInstanceOf(Date);
  });

  it("restores the tab order from sheetIndex whatever order the rows arrive in", () => {
    const rebuilt = buildSnapshotWorkbook([
      {
        sheetName: "Second",
        sheetIndex: 1,
        rows: [{ rowIndex: 1, cells: ["b"] }],
      },
      {
        sheetName: "First",
        sheetIndex: 0,
        rows: [{ rowIndex: 1, cells: ["a"] }],
      },
    ]);

    expect(rebuilt.worksheets.map((s) => s.name)).toEqual(["First", "Second"]);
  });
});
