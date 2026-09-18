import * as ExcelJS from "exceljs";
import { ProformaInvoice } from "../proforma-invoice.entity";
import { toNumberOrNull } from "../../common/utils/numeric";
import { computeLineItemsTotals } from "./compute-line-items-totals";

const LINE_ITEM_HEADERS = [
  "Material Num",
  "Material Desc",
  "SO Number",
  "Balance To Be Delivered",
  "Quantity",
  "MT",
  "Load Factor",
  "Loadability",
  "Current Week Dispatch Load Factor",
  "Current Week Dispatch Qty",
];

/**
 * One sheet: a header block (PI number/status/SO numbers/aggregates) above
 * a blank row, then the line-items table with a "Всего" totals row at the
 * bottom (same math as the frontend's own totals row —
 * computeLineItemsTotals). `pi.lineItems` must already be loaded.
 */
export function buildPiExportWorkbook(pi: ProformaInvoice): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("PI");
  const lineItems = pi.lineItems ?? [];

  const soNumbers = [
    ...new Set(lineItems.map((li) => li.soNumber).filter((v): v is string => !!v)),
  ];

  sheet.addRow(["PI number", pi.piNumber]);
  sheet.addRow(["Status", pi.status]);
  sheet.addRow(["SO numbers", soNumbers.join(", ")]);
  sheet.addRow(["Total Qty", toNumberOrNull(pi.totalQty)]);
  sheet.addRow(["Qty Pending", toNumberOrNull(pi.qtyPending)]);
  sheet.addRow(["Total Containers", toNumberOrNull(pi.totalContainers)]);
  sheet.addRow(["Containers Pending", toNumberOrNull(pi.containersPending)]);
  sheet.addRow([
    "Current Week Plan Containers",
    toNumberOrNull(pi.currentWeekPlanContainers),
  ]);
  sheet.addRow(["Current Week Plan Qty", toNumberOrNull(pi.currentWeekPlanQty)]);
  sheet.addRow([]);

  const headerRow = sheet.addRow(LINE_ITEM_HEADERS);
  headerRow.font = { bold: true };

  for (const item of lineItems) {
    sheet.addRow([
      item.materialNum,
      item.materialDesc,
      item.soNumber,
      toNumberOrNull(item.balanceToBeDelivered),
      toNumberOrNull(item.quantity),
      toNumberOrNull(item.mt),
      toNumberOrNull(item.loadFactor),
      toNumberOrNull(item.loadability),
      toNumberOrNull(item.currentWeekDispatchLoadFactor),
      toNumberOrNull(item.currentWeekDispatchQty),
    ]);
  }

  const totals = computeLineItemsTotals(lineItems, pi);
  const totalsRow = sheet.addRow([
    "Всего",
    null,
    null,
    totals.balanceToBeDelivered,
    totals.quantity,
    totals.mt,
    totals.loadFactor,
    null,
    totals.currentWeekDispatchLoadFactor,
    totals.currentWeekDispatchQty,
  ]);
  totalsRow.font = { bold: true };

  sheet.columns.forEach((col) => {
    col.width = 20;
  });

  return workbook;
}
