import * as ExcelJS from "exceljs";
import {
  toDateOrNull,
  toIdentifierOrNull,
  toNumberOrNull,
  toStringOrNull,
  unwrapFormula,
} from "./cell-values";

export interface ParsedContainerRow {
  containerNumber: string;
  customerCode: string | null;
  port: string | null;
  vesselName: string | null;
  sourceEtd: string | null;
  sourceEta: string | null;
  preshipmentInvoice: string | null;
  commercialInvoiceNumber: string | null;
}

export interface ParsedEta15Row {
  containerNumber: string;
  /** This sheet's own ETD / ETA columns — used only to fill a date ETD-ETA lacks. */
  etd: string | null;
  eta: string | null;
  blNumber: string | null;
  currency: string | null;
  invoiceValue: number | null;
  documentsReleaseStatus: string | null;
  telexReleaseDate: string | null;
  paymentReceiptStatus: string | null;
}

export interface ParsedDispatchRow {
  containerNumber: string;
  customerCode: string | null;
  piNumber: string | null;
  invoiceNumber: string | null;
  pgiDate: string | null;
  materialNum: string | null;
  materialDesc: string | null;
  quantity: number;
  customerOrderRef: string | null;
}

export interface ParsedActualContainersData {
  /** "ETD-ETA": one row per container (a repeated container keeps its last row). */
  containers: ParsedContainerRow[];
  /** "ETA-15 days": the narrow sample of containers close to arrival. */
  eta15: ParsedEta15Row[];
  /** "Radial Dispatch" + "Bias Dispatch", both sheets flattened into one list. */
  dispatchRows: ParsedDispatchRow[];
  /**
   * Dispatch rows dropped because they carry no container id or no readable
   * quantity — they can't be attached to a container / summed.
   */
  dispatchRowsSkipped: number;
}

const DISPATCH_SHEETS = new Set(["radial dispatch", "bias dispatch"]);
const ETD_ETA_SHEET = "etd-eta";
const ETA_15_SHEET = "eta-15 days";

function normalizeHeader(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeSheetName(name: string): string {
  return normalizeHeader(name);
}

/** Container numbers are ISO 6346 codes — upper case by definition. */
function toContainerNumber(value: unknown): string | null {
  const text = toStringOrNull(value);
  return text ? text.replace(/\s+/g, "").toUpperCase() : null;
}

interface SheetColumns {
  firstDataRow: number;
  columnOf: (header: string) => number | undefined;
}

/** The header row is the first of the top few that has every required column. */
function locateColumns(
  sheet: ExcelJS.Worksheet,
  requiredHeaders: string[],
): SheetColumns | null {
  const maxScanRows = Math.min(sheet.rowCount, 5);
  for (let rowNumber = 1; rowNumber <= maxScanRows; rowNumber++) {
    const columnMap = new Map<string, number>();
    sheet
      .getRow(rowNumber)
      .eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const text = toStringOrNull(cell.value);
        if (text && !columnMap.has(normalizeHeader(text))) {
          columnMap.set(normalizeHeader(text), colNumber);
        }
      });
    if (requiredHeaders.every((header) => columnMap.has(header))) {
      return {
        firstDataRow: rowNumber + 1,
        columnOf: (header) => columnMap.get(header),
      };
    }
  }
  return null;
}

function cellReader(sheet: ExcelJS.Worksheet, columns: SheetColumns) {
  return (rowNumber: number, header: string): unknown => {
    const col = columns.columnOf(header);
    return col === undefined
      ? undefined
      : sheet.getRow(rowNumber).getCell(col).value;
  };
}

function parseEtdEtaSheet(sheet: ExcelJS.Worksheet): ParsedContainerRow[] {
  const columns = locateColumns(sheet, ["container no"]);
  if (!columns) {
    return [];
  }
  const read = cellReader(sheet, columns);
  const byContainer = new Map<string, ParsedContainerRow>();
  for (
    let rowNumber = columns.firstDataRow;
    rowNumber <= sheet.rowCount;
    rowNumber++
  ) {
    const containerNumber = toContainerNumber(read(rowNumber, "container no"));
    if (!containerNumber) {
      continue;
    }
    byContainer.set(containerNumber, {
      containerNumber,
      customerCode: toIdentifierOrNull(read(rowNumber, "customer code")),
      port: toIdentifierOrNull(read(rowNumber, "port")),
      vesselName: toIdentifierOrNull(read(rowNumber, "vessel name")),
      sourceEtd: toDateOrNull(read(rowNumber, "etd")),
      sourceEta: toDateOrNull(read(rowNumber, "eta")),
      preshipmentInvoice: toIdentifierOrNull(
        read(rowNumber, "preshipment invoice"),
      ),
      commercialInvoiceNumber: toIdentifierOrNull(
        read(rowNumber, "commercial invoice number"),
      ),
    });
  }
  return [...byContainer.values()];
}

/**
 * The status columns of "ETA-15 days" arrive in whatever the cell happens to
 * hold: a date-formatted 0 (= empty, see toDateOrNull), a real date, a number
 * or a word. Keep what carries information, as text.
 */
function toStatusText(value: unknown): string | null {
  const unwrapped = unwrapFormula(value);
  if (unwrapped instanceof Date) {
    return toDateOrNull(unwrapped);
  }
  return toStringOrNull(unwrapped);
}

function parseEta15Sheet(sheet: ExcelJS.Worksheet): ParsedEta15Row[] {
  const columns = locateColumns(sheet, ["container no"]);
  if (!columns) {
    return [];
  }
  const read = cellReader(sheet, columns);
  const byContainer = new Map<string, ParsedEta15Row>();
  for (
    let rowNumber = columns.firstDataRow;
    rowNumber <= sheet.rowCount;
    rowNumber++
  ) {
    const containerNumber = toContainerNumber(read(rowNumber, "container no"));
    if (!containerNumber) {
      continue;
    }
    byContainer.set(containerNumber, {
      containerNumber,
      etd: toDateOrNull(read(rowNumber, "etd")),
      eta: toDateOrNull(read(rowNumber, "eta")),
      blNumber: toStringOrNull(read(rowNumber, "b/l no.")),
      currency: toStringOrNull(read(rowNumber, "currency")),
      invoiceValue: toNumberOrNull(read(rowNumber, "invoice value doc cur.")),
      documentsReleaseStatus: toStatusText(
        read(rowNumber, "documents release"),
      ),
      telexReleaseDate: toDateOrNull(read(rowNumber, "telex release date")),
      paymentReceiptStatus: toStatusText(
        read(rowNumber, "payment receipt status"),
      ),
    });
  }
  return [...byContainer.values()];
}

function parseDispatchSheet(sheet: ExcelJS.Worksheet): {
  rows: ParsedDispatchRow[];
  skipped: number;
} {
  const columns = locateColumns(sheet, ["container id"]);
  if (!columns) {
    return { rows: [], skipped: 0 };
  }
  const read = cellReader(sheet, columns);
  const rows: ParsedDispatchRow[] = [];
  let skipped = 0;
  for (
    let rowNumber = columns.firstDataRow;
    rowNumber <= sheet.rowCount;
    rowNumber++
  ) {
    const containerNumber = toContainerNumber(read(rowNumber, "container id"));
    const quantity = toNumberOrNull(read(rowNumber, "quantity"));
    const materialNum = toIdentifierOrNull(read(rowNumber, "material number"));
    if (!containerNumber || quantity === null) {
      // Blank padding rows have neither a container nor a material; only a
      // row that has *something* but can't be used is worth reporting.
      if (materialNum || containerNumber) {
        skipped++;
      }
      continue;
    }
    rows.push({
      containerNumber,
      customerCode: toIdentifierOrNull(read(rowNumber, "sold to party code")),
      piNumber: toIdentifierOrNull(read(rowNumber, "quotation number")),
      invoiceNumber: toIdentifierOrNull(read(rowNumber, "invoice number")),
      pgiDate: toDateOrNull(read(rowNumber, "pgi date")),
      materialNum,
      materialDesc: toStringOrNull(read(rowNumber, "material descp")),
      quantity,
      customerOrderRef: toStringOrNull(
        read(rowNumber, "customer order ref. no"),
      ),
    });
  }
  return { rows, skipped };
}

/**
 * The shipped-container half of the weekly workbook: "ETD-ETA", "ETA-15 days"
 * and the two Dispatch sheets. Both Dispatch sheets are flattened into one
 * list on purpose — the real file has 33 containers whose lines are split
 * between Radial and Bias, so a container's lines must be replaced from the
 * union of both sheets, never sheet by sheet.
 */
export function parseActualContainerSheets(
  workbook: ExcelJS.Workbook,
): ParsedActualContainersData {
  const result: ParsedActualContainersData = {
    containers: [],
    eta15: [],
    dispatchRows: [],
    dispatchRowsSkipped: 0,
  };
  for (const sheet of workbook.worksheets) {
    const name = normalizeSheetName(sheet.name);
    if (name === ETD_ETA_SHEET) {
      result.containers.push(...parseEtdEtaSheet(sheet));
    } else if (name === ETA_15_SHEET) {
      result.eta15.push(...parseEta15Sheet(sheet));
    } else if (DISPATCH_SHEETS.has(name)) {
      const { rows, skipped } = parseDispatchSheet(sheet);
      result.dispatchRows.push(...rows);
      result.dispatchRowsSkipped += skipped;
    }
  }
  return result;
}
