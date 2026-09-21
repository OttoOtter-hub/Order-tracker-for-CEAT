import * as ExcelJS from "exceljs";
import type { ReadyToShipView } from "../ready-to-ship.types";

export const OK_TO_MIX = "OK to mix";

export const READY_TO_SHIP_EXPORT_HEADERS = [
  "Контейнер",
  "SKU",
  "Описание",
  "Количество",
  "Load Factor",
  "Проформа (PI)",
  "SO",
] as const;

export interface ReadyToShipExportRow {
  /** The container's number, its label when that is not "Контейнер N", or OK_TO_MIX. */
  container: number | string;
  sku: string | null;
  description: string | null;
  quantity: number;
  /** quantity / loadability to 4 places; null when the line has no loadability. */
  loadFactor: number | null;
  piNumber: string;
  soNumber: string | null;
}

const CONTAINER_LABEL = /^\s*Контейнер\s+(\d+)\s*$/i;

/** "Контейнер 12" -> 12; any other label is kept as it is. */
export function containerCell(label: string): number | string {
  const match = CONTAINER_LABEL.exec(label);
  return match ? Number(match[1]) : label;
}

function loadFactorOf(
  quantity: number,
  loadability: number | null,
): number | null {
  if (!loadability || loadability <= 0) {
    return null;
  }
  return Math.round((quantity / loadability) * 10000) / 10000;
}

/** Numbered containers first (ascending), then other labels, then OK to mix. */
function rank(container: number | string): number {
  if (typeof container === "number") return 0;
  return container === OK_TO_MIX ? 2 : 1;
}

function compareRows(a: ReadyToShipExportRow, b: ReadyToShipExportRow): number {
  const byRank = rank(a.container) - rank(b.container);
  if (byRank !== 0) return byRank;
  if (typeof a.container === "number" && typeof b.container === "number") {
    if (a.container !== b.container) return a.container - b.container;
  } else if (a.container !== b.container) {
    return String(a.container).localeCompare(String(b.container));
  }
  return (
    a.piNumber.localeCompare(b.piNumber) ||
    (a.sku ?? "").localeCompare(b.sku ?? "") ||
    (a.soNumber ?? "").localeCompare(b.soNumber ?? "")
  );
}

/**
 * The flat list behind the ready-to-ship export: one row per allocation
 * (its container), then one row per line that still has an undistributed
 * remainder, as "OK to mix". Lines without a loadability can't be placed, so
 * they only ever appear as "OK to mix", with an empty Load Factor.
 */
export function buildReadyToShipExportRows(
  view: Pick<ReadyToShipView, "containers" | "unallocatedLines">,
): ReadyToShipExportRow[] {
  const rows: ReadyToShipExportRow[] = [];

  for (const container of view.containers) {
    for (const allocation of container.allocations) {
      rows.push({
        container: containerCell(container.label),
        sku: allocation.materialNum,
        description: allocation.materialDesc,
        quantity: allocation.allocatedQty,
        loadFactor: loadFactorOf(
          allocation.allocatedQty,
          allocation.loadability,
        ),
        piNumber: allocation.piNumber,
        soNumber: allocation.soNumber,
      });
    }
  }

  for (const line of view.unallocatedLines) {
    if (!(line.remainingQty > 0)) {
      continue;
    }
    rows.push({
      container: OK_TO_MIX,
      sku: line.materialNum,
      description: line.materialDesc,
      quantity: line.remainingQty,
      loadFactor: loadFactorOf(line.remainingQty, line.loadability),
      piNumber: line.piNumber,
      soNumber: line.soNumber,
    });
  }

  return rows.sort(compareRows);
}

export function buildReadyToShipExportWorkbook(
  view: Pick<ReadyToShipView, "containers" | "unallocatedLines">,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Ready to ship");

  const header = sheet.addRow([...READY_TO_SHIP_EXPORT_HEADERS]);
  header.font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const row of buildReadyToShipExportRows(view)) {
    sheet.addRow([
      row.container,
      row.sku,
      row.description,
      row.quantity,
      row.loadFactor,
      row.piNumber,
      row.soNumber,
    ]);
  }

  sheet.getColumn(5).numFmt = "0.0000";
  const widths = [12, 14, 44, 12, 12, 16, 14];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: READY_TO_SHIP_EXPORT_HEADERS.length },
  };

  return workbook;
}
