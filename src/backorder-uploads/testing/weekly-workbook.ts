import * as ExcelJS from "exceljs";

/**
 * Builds a weekly-backorder-shaped workbook for specs: the open-backorder
 * sheets plus ETD-ETA / ETA-15 days / Radial+Bias Dispatch, with the quirks of
 * the real MTK_ROSBERG_INR.xlsx that the parsers have to cope with — numbers
 * where ids are, 0 for "nothing", and Excel's zero date (1899-12-30) for an
 * empty date cell.
 */

export const BO_HEADERS = [
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

const DISPATCH_HEADERS = [
  "Sold to Party Code",
  "Sold To Party Name",
  "Invoice Number",
  "PGI Date",
  "Quotation Number",
  "Material Number",
  "Material Descp",
  "Quantity",
  "Container ID",
  "Customer Order Ref. No",
  "Material Category",
];

// Trailing spaces in "Customer code   " are in the real file.
const ETD_ETA_HEADERS = [
  "Customer code   ",
  "Customer Name",
  "PORT",
  "Vessel Name",
  "ETD",
  "ETA",
  "Container No",
  "Preshipment Invoice",
  "Commercial Invoice number",
];

const ETA_15_HEADERS = [
  "Code",
  "Customer Name",
  "Country",
  "PORT",
  "Incoterms",
  "Commercial Invoice No.",
  "B/L No.",
  "Container No",
  "Currency",
  "Invoice Value Doc cur.",
  "ETD",
  "ETA",
  "Documents Release",
  "Telex release date",
  "Payment Receipt Status",
];

/** Excel's stored "no date": a date-formatted 0. */
export const EXCEL_ZERO_DATE = new Date(Date.UTC(1899, 11, 30));

/** "2026-07-01" -> that day; null -> Excel's zero date, like an empty cell in the real file. */
export function excelDate(day: string | null): Date {
  return day === null ? EXCEL_ZERO_DATE : new Date(`${day}T00:00:00Z`);
}

export function boRow(
  piNumber: number,
  materialNum: string,
  balance = 2,
): unknown[] {
  return [
    66000402,
    'MTK ROSBERG LLC "INR"',
    300029159,
    materialNum,
    "some tyre",
    balance,
    piNumber,
    "Novorossiysk",
    "2026-06-16",
    2,
    "PO",
    0.5,
    0.1,
    20,
    0.5,
    0.1,
    2,
  ];
}

export interface DispatchRowSpec {
  container: string;
  pi: number | null;
  material?: number;
  qty: number;
  invoice?: number;
  pgi?: string;
  ref?: string;
  category?: "Radial" | "Bias";
}

export function dispatchRow(spec: DispatchRowSpec): unknown[] {
  return [
    66000402,
    'MTK ROSBERG LLC "INR"',
    spec.invoice ?? 340287276,
    excelDate(spec.pgi ?? "2026-03-26"),
    spec.pi,
    spec.material ?? 112935,
    "some tyre",
    spec.qty,
    spec.container,
    spec.ref ?? "Email dated 06.02.2026",
    spec.category ?? "Radial",
  ];
}

export interface ContainerRowSpec {
  container: string;
  port?: string;
  vessel?: string | number;
  etd?: string | null;
  eta?: string | null;
  preshipment?: number;
  commercial?: number;
}

export function containerRow(spec: ContainerRowSpec): unknown[] {
  return [
    66000402,
    'MTK ROSBERG LLC "INR"',
    spec.port ?? "Novorossiysk",
    spec.vessel ?? "MV TEST 1",
    excelDate(spec.etd === undefined ? "2026-07-01" : spec.etd),
    excelDate(spec.eta === undefined ? null : spec.eta),
    spec.container,
    spec.preshipment ?? 0,
    spec.commercial ?? 9357868246,
  ];
}

export interface Eta15RowSpec {
  container: string;
  bl?: string;
  currency?: string;
  value?: number;
  docs?: number | string;
  telex?: string | null;
  payment?: string | null;
}

export function eta15Row(spec: Eta15RowSpec): unknown[] {
  return [
    66000402,
    'MTK ROSBERG LLC "INR"',
    "Russian Fed.",
    "Novorossiysk",
    "CFR",
    9357956783,
    spec.bl ?? "ALIN26000843  ",
    spec.container,
    spec.currency ?? "INR",
    spec.value ?? 2423377.89,
    excelDate("2026-07-31"),
    excelDate("2026-09-20"),
    spec.docs ?? 0,
    excelDate(spec.telex === undefined ? null : spec.telex),
    excelDate(spec.payment === undefined ? null : spec.payment),
  ];
}

export interface WeeklyWorkbookSpec {
  bo?: unknown[][];
  radialDispatch?: unknown[][];
  biasDispatch?: unknown[][];
  containers?: unknown[][];
  eta15?: unknown[][];
  /** Adds the workbook's "Summary" sheet, which no parser reads. */
  summary?: boolean;
}

function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: unknown[][],
): void {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(headers);
  for (const row of rows) {
    const added = sheet.addRow(row);
    added.eachCell((cell) => {
      if (cell.value instanceof Date) {
        cell.numFmt = "yyyy-mm-dd";
      }
    });
  }
}

export function buildWeeklyWorkbook(
  spec: WeeklyWorkbookSpec,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  if (spec.summary) {
    const summary = workbook.addWorksheet("Summary");
    summary.addRow(["Open Order Summary", "Open Order Summary"]);
    summary.addRow(["Segment", "Customer Name"]);
    summary.addRow(["Radial", "MTK ROSBERG INR"]);
  }
  addSheet(workbook, "Radial BO", BO_HEADERS, spec.bo ?? []);
  addSheet(
    workbook,
    "Radial Dispatch",
    DISPATCH_HEADERS,
    spec.radialDispatch ?? [],
  );
  addSheet(
    workbook,
    "Bias Dispatch",
    DISPATCH_HEADERS,
    spec.biasDispatch ?? [],
  );
  addSheet(workbook, "ETD-ETA", ETD_ETA_HEADERS, spec.containers ?? []);
  addSheet(workbook, "ETA-15 days", ETA_15_HEADERS, spec.eta15 ?? []);
  return workbook;
}

export async function buildWeeklyFile(
  spec: WeeklyWorkbookSpec,
): Promise<{ originalname: string; buffer: Buffer }> {
  const arrayBuffer = await buildWeeklyWorkbook(spec).xlsx.writeBuffer();
  return {
    originalname: "2907_MTK_ROSBERG_INR.xlsx",
    buffer: Buffer.from(arrayBuffer),
  };
}
