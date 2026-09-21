import * as ExcelJS from "exceljs";
import { ProformaInvoice } from "../../proforma-invoices/proforma-invoice.entity";
import { toNumberOrNull } from "../../common/utils/numeric";
import { formatDateForFilename } from "../../common/utils/format-date";
import {
  priorityLoadFactorCell,
  priorityQtyCell,
} from "../../proforma-invoices/utils/priority-export-cells";

const ROW_HEADERS = [
  "PI Number",
  "PI Status",
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
  "Priority Qty",
  "Priority Load Factor",
];

/**
 * One row per PiLineItem across every *active* (not archived) PI —
 * `pis` must already be filtered to is_archived_shipped=false and have
 * `lineItems` loaded; this function doesn't re-check either. Two dates in
 * the header, both explicit about what they mean: when the underlying
 * backorder file was uploaded (source truth for what "still open" means)
 * vs. when this export was generated (could be any later moment).
 */
export function buildBackorderExportWorkbook(
  pis: ProformaInvoice[],
  latestUploadDate: Date | null,
  generatedAt: Date,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Backorder");

  sheet.addRow([
    `Бэкордер от ${latestUploadDate ? formatDateForFilename(latestUploadDate) : "—"}`,
  ]);
  sheet.addRow([`Выгружено: ${formatDateForFilename(generatedAt)}`]);
  sheet.addRow([]);

  const headerRow = sheet.addRow(ROW_HEADERS);
  headerRow.font = { bold: true };

  for (const pi of pis) {
    for (const item of pi.lineItems ?? []) {
      sheet.addRow([
        pi.piNumber,
        pi.status,
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
        priorityQtyCell(item.priorityQty),
        priorityLoadFactorCell(item.priorityQty, item.loadability),
      ]);
    }
  }

  sheet.columns.forEach((col) => {
    col.width = 20;
  });

  return workbook;
}
