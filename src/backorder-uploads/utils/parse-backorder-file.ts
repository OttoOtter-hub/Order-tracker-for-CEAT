import * as ExcelJS from "exceljs";

export interface ParsedBackorderRow {
  piNumber: string;
  soNumber: string | null;
  materialNum: string | null;
  materialDesc: string | null;
  balanceToBeDelivered: number | null;
  quantity: number | null;
  mt: number | null;
  loadFactor: number | null;
  loadability: number | null;
  currentWeekDispatchLoadFactor: number | null;
  currentWeekDispatchQty: number | null;
}

export interface ParseBackorderFileResult {
  rows: ParsedBackorderRow[];
  /**
   * Rows that had *some* data (a material number) but no PI number — the
   * "Quotation" cell was blank/unreadable, so the row can't be attributed
   * to any card and is dropped. Deliberately distinct from rows that are
   * simply blank (Excel used-range padding at the end of a sheet, or a
   * true footer row) — those have no material number either and aren't
   * "invalid," just empty, so they're not counted here.
   */
  skippedRowCount: number;
}

/**
 * Only these two sheets are ever parsed — the source workbook (the
 * factory's weekly export) also carries Summary/Dispatch/ETD-ETA/payment
 * sheets that describe already-shipped/invoiced state, out of scope for
 * this endpoint (open backorder only). Any other sheet, present now or
 * added later, is silently ignored rather than guessed at or rejected —
 * this parser's job is "read what it recognizes," not "validate the whole
 * workbook."
 */
const TARGET_SHEET_NAMES = new Set(["radial bo", "bias bo"]);

interface CellValueLike {
  result?: unknown;
}

function unwrapFormula(value: unknown): unknown {
  if (value && typeof value === "object" && "result" in (value as CellValueLike)) {
    return (value as CellValueLike).result;
  }
  return value;
}

function toStringOrNull(value: unknown): string | null {
  const unwrapped = unwrapFormula(value);
  if (unwrapped === null || unwrapped === undefined) {
    return null;
  }
  const str = String(unwrapped).trim();
  return str.length > 0 ? str : null;
}

function toNumberOrNull(value: unknown): number | null {
  const unwrapped = unwrapFormula(value);
  if (unwrapped === null || unwrapped === undefined || unwrapped === "") {
    return null;
  }
  const num = typeof unwrapped === "number" ? unwrapped : Number(unwrapped);
  return Number.isFinite(num) ? num : null;
}

interface HeaderInfo {
  rowNumber: number;
  columnMap: Map<string, number>;
}

/**
 * The header row isn't always row 1 — the real export sometimes has a
 * lone customer-code row above the header on one sheet but not another
 * (observed: "Radial BO" has it, "Bias BO" doesn't). Scan the first few
 * rows for one containing a "MaterialNum" cell instead of assuming a fixed
 * offset.
 */
function findHeaderRow(sheet: ExcelJS.Worksheet): HeaderInfo | null {
  const maxScanRows = Math.min(sheet.rowCount, 5);
  for (let rowNumber = 1; rowNumber <= maxScanRows; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const columnMap = new Map<string, number>();
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = toStringOrNull(cell.value);
      if (text) {
        columnMap.set(text.toLowerCase(), colNumber);
      }
    });
    if ([...columnMap.keys()].some((header) => header === "materialnum")) {
      return { rowNumber, columnMap };
    }
  }
  return null;
}

function findColumn(
  columnMap: Map<string, number>,
  matcher: (header: string) => boolean,
): number | undefined {
  for (const [header, index] of columnMap) {
    if (matcher(header)) {
      return index;
    }
  }
  return undefined;
}

interface ParseSheetResult {
  rows: ParsedBackorderRow[];
  skippedRowCount: number;
}

function parseSheet(sheet: ExcelJS.Worksheet): ParseSheetResult {
  const header = findHeaderRow(sheet);
  if (!header) {
    return { rows: [], skippedRowCount: 0 };
  }

  const columns = {
    piNumber: findColumn(header.columnMap, (h) => h === "quotation"),
    soNumber: findColumn(header.columnMap, (h) => h === "salesordernum"),
    materialNum: findColumn(header.columnMap, (h) => h === "materialnum"),
    materialDesc: findColumn(header.columnMap, (h) => h === "materialdesc"),
    balanceToBeDelivered: findColumn(header.columnMap, (h) =>
      h.includes("balance to be delivered"),
    ),
    quantity: findColumn(header.columnMap, (h) => h === "quantity"),
    mt: findColumn(header.columnMap, (h) => h === "mt"),
    loadFactor: findColumn(header.columnMap, (h) => h === "load factor"),
    // "Radial Load.Loadability" on one sheet, "Bias Load.Loadability" on
    // the other — match on the shared suffix, not the segment prefix.
    loadability: findColumn(header.columnMap, (h) => h.includes("loadability")),
    currentWeekDispatchLoadFactor: findColumn(header.columnMap, (h) =>
      h.includes("current week dispatch plan (load factor)"),
    ),
    currentWeekDispatchQty: findColumn(header.columnMap, (h) =>
      h.includes("current week dispatch plan (qty)"),
    ),
  };

  // Doesn't look like the expected shape (e.g. someone renamed the sheet
  // but the columns are unrelated) — skip rather than parse garbage.
  if (columns.piNumber === undefined || columns.materialNum === undefined) {
    return { rows: [], skippedRowCount: 0 };
  }

  const getCell = (row: ExcelJS.Row, col: number | undefined) =>
    col === undefined ? undefined : row.getCell(col).value;

  const rows: ParsedBackorderRow[] = [];
  let skippedRowCount = 0;
  for (let rowNumber = header.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const piNumber = toStringOrNull(getCell(row, columns.piNumber));
    if (!piNumber) {
      // A row with a material number but no readable PI number is real
      // data the parser couldn't attribute to a card — worth reporting.
      // A row with neither is just blank padding at the end of the sheet,
      // not a business event.
      if (toStringOrNull(getCell(row, columns.materialNum))) {
        skippedRowCount++;
      }
      continue;
    }
    rows.push({
      piNumber,
      soNumber: toStringOrNull(getCell(row, columns.soNumber)),
      materialNum: toStringOrNull(getCell(row, columns.materialNum)),
      materialDesc: toStringOrNull(getCell(row, columns.materialDesc)),
      balanceToBeDelivered: toNumberOrNull(getCell(row, columns.balanceToBeDelivered)),
      quantity: toNumberOrNull(getCell(row, columns.quantity)),
      mt: toNumberOrNull(getCell(row, columns.mt)),
      loadFactor: toNumberOrNull(getCell(row, columns.loadFactor)),
      loadability: toNumberOrNull(getCell(row, columns.loadability)),
      currentWeekDispatchLoadFactor: toNumberOrNull(
        getCell(row, columns.currentWeekDispatchLoadFactor),
      ),
      currentWeekDispatchQty: toNumberOrNull(getCell(row, columns.currentWeekDispatchQty)),
    });
  }
  return { rows, skippedRowCount };
}

export async function parseBackorderFile(
  buffer: Buffer,
): Promise<ParseBackorderFileResult> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's bundled .d.ts resolves `Buffer` to an ambient type that
  // TypeScript treats as structurally incompatible with this project's
  // @types/node `Buffer<ArrayBufferLike>`, even though it's the same
  // runtime value — `any` sidesteps that mismatch; the value passed in is
  // a real Buffer either way.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);

  const rows: ParsedBackorderRow[] = [];
  let skippedRowCount = 0;
  for (const sheet of workbook.worksheets) {
    if (!TARGET_SHEET_NAMES.has(sheet.name.trim().toLowerCase())) {
      continue;
    }
    const result = parseSheet(sheet);
    rows.push(...result.rows);
    skippedRowCount += result.skippedRowCount;
  }
  return { rows, skippedRowCount };
}
