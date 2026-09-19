import * as ExcelJS from "exceljs";

/** A JSON-safe cell: primitives as they are, a date as { $date: ISO string }. */
export type SnapshotCell = string | number | boolean | null | { $date: string };

export interface SnapshotRow {
  /** 1-based Excel row number — gaps between rows are kept, blank rows are not. */
  rowIndex: number;
  /** Cell values by column, index 0 = column A; trailing empties trimmed. */
  cells: SnapshotCell[];
}

export interface SnapshotSheet {
  sheetName: string;
  /** Position of the sheet in the workbook, so an export restores the tab order. */
  sheetIndex: number;
  rows: SnapshotRow[];
}

function normalizeCell(value: unknown): SnapshotCell {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : { $date: value.toISOString() };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Formula cell: what the file "says" is the cached result, not the formula.
    if ("result" in obj) {
      return normalizeCell(obj.result);
    }
    if ("richText" in obj && Array.isArray(obj.richText)) {
      return (obj.richText as { text?: string }[])
        .map((r) => r.text ?? "")
        .join("");
    }
    if ("text" in obj) {
      return normalizeCell(obj.text);
    }
    if ("error" in obj) {
      return String(obj.error);
    }
    if ("formula" in obj || "sharedFormula" in obj) {
      return null;
    }
  }
  return String(value);
}

/**
 * Every sheet of the workbook (hidden ones too), row by row, as plain JSON —
 * the "what was actually in the file this week" archive. Nothing is
 * interpreted here: the same values the typed parsers read, before any of
 * them decides what a 0 or a 1899 date means.
 */
export function extractSnapshotSheets(
  workbook: ExcelJS.Workbook,
): SnapshotSheet[] {
  return workbook.worksheets.map((sheet, sheetIndex) => {
    const rows: SnapshotRow[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: SnapshotCell[] = [];
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        cells[colNumber - 1] = normalizeCell(cell.value);
      });
      const filled: SnapshotCell[] = Array.from(cells, (c) => c ?? null);
      while (filled.length > 0 && filled[filled.length - 1] === null) {
        filled.pop();
      }
      if (filled.length > 0) {
        rows.push({ rowIndex: rowNumber, cells: filled });
      }
    });
    return { sheetName: sheet.name, sheetIndex, rows };
  });
}

function reviveCell(
  cell: SnapshotCell,
): string | number | boolean | Date | null {
  if (cell !== null && typeof cell === "object" && "$date" in cell) {
    return new Date(cell.$date);
  }
  return cell;
}

/** The reverse of extractSnapshotSheets: an .xlsx with the stored cells back in place. */
export function buildSnapshotWorkbook(
  sheets: SnapshotSheet[],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const ordered = [...sheets].sort((a, b) => a.sheetIndex - b.sheetIndex);
  for (const sheet of ordered) {
    // Excel sheet names: max 31 chars, none of : \ / ? * [ ] — the source
    // workbook already obeys that, this only guards a corrupted row.
    const name =
      sheet.sheetName.replace(/[:\\/?*[\]]/g, "_").slice(0, 31) || "Sheet";
    const worksheet = workbook.addWorksheet(name);
    const rows = [...sheet.rows].sort((a, b) => a.rowIndex - b.rowIndex);
    for (const row of rows) {
      const target = worksheet.getRow(row.rowIndex);
      row.cells.forEach((cell, index) => {
        const value = reviveCell(cell);
        if (value === null) {
          return;
        }
        const targetCell = target.getCell(index + 1);
        targetCell.value = value;
        if (value instanceof Date) {
          targetCell.numFmt = "yyyy-mm-dd";
        }
      });
    }
  }
  return workbook;
}
