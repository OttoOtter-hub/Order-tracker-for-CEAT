import * as ExcelJS from "exceljs";
import type { ReadyToShipView } from "../ready-to-ship.types";

export const OK_TO_MIX = "OK to mix";

export const READY_TO_SHIP_EXPORT_HEADERS = [
  "Container",
  // Phase 22: the client's name for the container. "Container Name" rather
  // than plain "Name" — the PI card's name already has that header.
  "Container Name",
  "SKU",
  "Description",
  "Quantity",
  "Load Factor",
  "Proforma (PI)",
  "Name",
  "SO",
] as const;

export interface ReadyToShipExportRow {
  /**
   * The container's number, or its label when that is not "Контейнер N"
   * (the real "OK to mix" container included); null — an empty cell — for a
   * remainder that sits in no container at all.
   */
  container: number | string | null;
  /** The client's name for the container; null (an empty cell) when unset. */
  containerName: string | null;
  sku: string | null;
  description: string | null;
  quantity: number;
  /** quantity / loadability to 4 places; null when the line has no loadability. */
  loadFactor: number | null;
  piNumber: string;
  /** The card's name, null (an empty cell) when it has none. */
  piLabel: string | null;
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

/**
 * Numbered containers first (ascending), then other labels, then OK to mix,
 * then the remainder that is in no container.
 */
function rank(container: number | string | null): number {
  if (container === null) return 3;
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
 * (its container — the real "OK to mix" one included, under its label),
 * then one row per line that still has an undistributed remainder, with an
 * empty Container cell (Phase 22: "OK to mix" now means only "placed in the
 * OK to mix container", not "not placed"). A line without loadability has
 * an empty Load Factor.
 */
export function buildReadyToShipExportRows(
  view: Pick<ReadyToShipView, "containers" | "unallocatedLines">,
): ReadyToShipExportRow[] {
  const rows: ReadyToShipExportRow[] = [];

  for (const container of view.containers) {
    for (const allocation of container.allocations) {
      rows.push({
        container: containerCell(container.label),
        containerName: container.name ?? null,
        sku: allocation.materialNum,
        description: allocation.materialDesc,
        quantity: allocation.allocatedQty,
        loadFactor: loadFactorOf(
          allocation.allocatedQty,
          allocation.loadability,
        ),
        piNumber: allocation.piNumber,
        piLabel: allocation.piLabel ?? null,
        soNumber: allocation.soNumber,
      });
    }
  }

  for (const line of view.unallocatedLines) {
    if (!(line.remainingQty > 0)) {
      continue;
    }
    rows.push({
      container: null,
      containerName: null,
      sku: line.materialNum,
      description: line.materialDesc,
      quantity: line.remainingQty,
      loadFactor: loadFactorOf(line.remainingQty, line.loadability),
      piNumber: line.piNumber,
      piLabel: line.piLabel ?? null,
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
      row.containerName,
      row.sku,
      row.description,
      row.quantity,
      row.loadFactor,
      row.piNumber,
      row.piLabel,
      row.soNumber,
    ]);
  }

  sheet.getColumn(6).numFmt = "0.0000";
  const widths = [12, 22, 14, 44, 12, 12, 16, 22, 14];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: READY_TO_SHIP_EXPORT_HEADERS.length },
  };

  return workbook;
}
