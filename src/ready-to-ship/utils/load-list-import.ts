import * as ExcelJS from "exceljs";
import type { ErrorDetail } from "../../common/errors/api-error";
import { OK_TO_MIX } from "./build-ready-to-ship-export-workbook";

/**
 * Phase 25: a load list uploaded as Excel — the same sheet the export gives
 * (Container, SKU, Proforma (PI), SO, Quantity; the other columns are read
 * past). Parsing and validation are pure (no database): the service hands in
 * the current containers and lines and gets back either a list of problems
 * per row or the complete new layout to write.
 */

export interface ImportRow {
  /** Spreadsheet row number (1-based, as Excel shows it). */
  row: number;
  container: string | number | null;
  sku: string | null;
  piNumber: string | null;
  soNumber: string | null;
  quantity: unknown;
}

const HEADERS = {
  container: "Container",
  sku: "SKU",
  piNumber: "Proforma (PI)",
  soNumber: "SO",
  quantity: "Quantity",
} as const;

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === "object") {
    if ("result" in value) return (value as { result: unknown }).result;
    if ("richText" in value) {
      return (value as { richText: { text: string }[] }).richText
        .map((r) => r.text)
        .join("");
    }
    if ("text" in value) return (value as { text: unknown }).text;
  }
  return value;
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/**
 * The rows of the first sheet that has the export's header row (any row,
 * any column order). Null when no sheet has it — not our file.
 */
export async function parseImportWorkbook(
  buffer: Buffer,
): Promise<ImportRow[] | null> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return null;
  }
  for (const sheet of workbook.worksheets) {
    let columns: Record<keyof typeof HEADERS, number> | null = null;
    const rows: ImportRow[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values = (row.values as ExcelJS.CellValue[]).map(cellValue);
      if (!columns) {
        const at = (header: string) =>
          values.findIndex(
            (v) => asText(v)?.toLowerCase() === header.toLowerCase(),
          );
        const found = {
          container: at(HEADERS.container),
          sku: at(HEADERS.sku),
          piNumber: at(HEADERS.piNumber),
          soNumber: at(HEADERS.soNumber),
          quantity: at(HEADERS.quantity),
        };
        if (Object.values(found).every((i) => i > 0)) {
          columns = found;
        }
        return;
      }
      const container = values[columns.container];
      rows.push({
        row: rowNumber,
        container:
          typeof container === "number" ? container : asText(container),
        sku: asText(values[columns.sku]),
        piNumber: asText(values[columns.piNumber]),
        soNumber: asText(values[columns.soNumber]),
        quantity: values[columns.quantity],
      });
    });
    if (columns) {
      return rows;
    }
  }
  return null;
}

export interface ImportLine {
  id: string;
  key: string;
  piNumber: string;
  materialNum: string | null;
  soNumber: string | null;
  dispatchQty: number;
  loadability: number | null;
}

export interface ImportPosition {
  lineId: string;
  qty: number;
  locked: boolean;
}

export interface ImportContainer {
  label: string;
  isOkToMix: boolean;
  positions: ImportPosition[];
}

export interface ImportPlan {
  errors: ErrorDetail[];
  /** Numbered containers the file names that don't exist yet (ops only). */
  newContainers: string[];
  /** The complete new unlocked layout: what to create after the old one goes. */
  assignments: { containerLabel: string; lineId: string; qty: number }[];
  rowsRead: number;
}

const NUMBERED = /^\s*Контейнер\s+(\d+)\s*$/i;

/** "Контейнер N" -> N; "OK to mix" -> as it is. */
function containerParam(label: string): string {
  const match = NUMBERED.exec(label);
  return match ? match[1] : label;
}

/**
 * Checks the whole file against the current state and, only when nothing is
 * wrong, works out the new layout. Confirmed (locked) positions stay as they
 * are: the file must show each with exactly its quantity. Everything else is
 * replaced by what the file says.
 */
export function planImport(input: {
  rows: ImportRow[];
  containers: ImportContainer[];
  lines: ImportLine[];
  /** Keys (piNumber|material|so) of lines whose card is archived. */
  archivedKeys: Set<string>;
  /** Ops may create numbered containers that don't exist yet. */
  mayCreateContainers: boolean;
}): ImportPlan {
  const errors: ErrorDetail[] = [];
  const lineById = new Map(input.lines.map((l) => [l.id, l]));
  const linesByKey = new Map<string, ImportLine[]>();
  for (const line of input.lines) {
    linesByKey.set(line.key, [...(linesByKey.get(line.key) ?? []), line]);
  }
  const containerByLabel = new Map(
    input.containers.map((c) => [c.label.toLowerCase(), c]),
  );
  const okToMix = input.containers.find((c) => c.isOkToMix);

  // container label -> key -> qty, and the first row behind each
  const target = new Map<string, Map<string, number>>();
  const firstRow = new Map<string, number>();
  // Every row of a key in file order — to name the one that crosses the stock.
  const rowsOfKey = new Map<string, { row: number; qty: number }[]>();
  const newContainers = new Set<string>();
  let rowsRead = 0;

  for (const r of input.rows) {
    const empty =
      r.container === null &&
      r.sku === null &&
      r.piNumber === null &&
      (r.quantity === null || r.quantity === undefined || r.quantity === "");
    if (empty) continue;
    rowsRead++;
    // A row without a container is the unallocated remainder — not placed.
    if (r.container === null) continue;

    const raw = r.quantity;
    const qty =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.trim() !== ""
          ? Number(raw.trim().replace(",", "."))
          : NaN;
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 0) {
      errors.push({
        code: "IMPORT_BAD_QUANTITY",
        row: r.row,
        params: { value: raw === null || raw === undefined ? "" : String(raw) },
      });
      continue;
    }
    if (qty === 0) continue;

    let label: string;
    if (typeof r.container === "number" || /^\d+$/.test(String(r.container))) {
      label = `Контейнер ${Number(r.container)}`;
    } else if (
      String(r.container).trim().toLowerCase() === OK_TO_MIX.toLowerCase()
    ) {
      label = okToMix?.label ?? OK_TO_MIX;
    } else {
      label = String(r.container).trim();
    }
    const existing = containerByLabel.get(label.toLowerCase());
    if (existing) {
      label = existing.label;
    } else if (label === OK_TO_MIX) {
      // The customer's OK to mix is made on demand; it always "exists".
    } else if (input.mayCreateContainers && NUMBERED.test(label)) {
      newContainers.add(label);
    } else {
      errors.push({
        code: "IMPORT_UNKNOWN_CONTAINER",
        row: r.row,
        params: { container: containerParam(label) },
      });
      continue;
    }

    const key = `${r.piNumber ?? ""}|${r.sku ?? ""}|${r.soNumber ?? ""}`;
    if (!linesByKey.has(key)) {
      errors.push({
        code: input.archivedKeys.has(key)
          ? "IMPORT_ARCHIVED_PI"
          : "IMPORT_UNKNOWN_LINE",
        row: r.row,
        params: {
          piNumber: r.piNumber ?? "—",
          materialNum: r.sku ?? "—",
          soNumber: r.soNumber ?? "—",
        },
      });
      continue;
    }

    const byKey = target.get(label) ?? new Map<string, number>();
    byKey.set(key, (byKey.get(key) ?? 0) + qty);
    target.set(label, byKey);
    if (!firstRow.has(`${label}#${key}`))
      firstRow.set(`${label}#${key}`, r.row);
    if (!firstRow.has(label)) firstRow.set(label, r.row);
    if (!firstRow.has(`#${key}`)) firstRow.set(`#${key}`, r.row);
    rowsOfKey.set(key, [...(rowsOfKey.get(key) ?? []), { row: r.row, qty }]);
  }

  // Confirmed positions: exactly as they are, or the file is wrong.
  const lockedByContainerKey = new Map<string, number>();
  const lockedByLine = new Map<string, number>();
  const lockedPair = new Set<string>();
  for (const container of input.containers) {
    for (const p of container.positions.filter((x) => x.locked)) {
      const line = lineById.get(p.lineId);
      if (!line) continue;
      const k = `${container.label}#${line.key}`;
      lockedByContainerKey.set(k, (lockedByContainerKey.get(k) ?? 0) + p.qty);
      lockedByLine.set(line.id, (lockedByLine.get(line.id) ?? 0) + p.qty);
      lockedPair.add(`${container.label}#${line.id}`);
    }
  }
  for (const [k, lockedQty] of lockedByContainerKey) {
    const [label, key] = [
      k.slice(0, k.indexOf("#")),
      k.slice(k.indexOf("#") + 1),
    ];
    const inFile = target.get(label)?.get(key) ?? 0;
    if (inFile !== lockedQty) {
      const line = linesByKey.get(key)![0];
      errors.push({
        code: "IMPORT_CONFIRMED_CHANGED",
        ...(firstRow.has(k) ? { row: firstRow.get(k) } : {}),
        params: {
          container: containerParam(label),
          piNumber: line.piNumber,
          materialNum: line.materialNum ?? "—",
          confirmed: lockedQty,
          file: inFile,
        },
      });
    }
  }
  // A fully confirmed container takes no new position.
  const blocked = new Set<string>();
  for (const container of input.containers) {
    const fullyLocked =
      container.positions.length > 0 &&
      container.positions.every((p) => p.locked);
    if (!fullyLocked) continue;
    for (const key of target.get(container.label)?.keys() ?? []) {
      if (!lockedByContainerKey.has(`${container.label}#${key}`)) {
        blocked.add(`${container.label}#${key}`);
        errors.push({
          code: "IMPORT_CONTAINER_LOCKED",
          row: firstRow.get(`${container.label}#${key}`),
          params: { container: containerParam(container.label) },
        });
      }
    }
  }

  const lockedTotalOf = (key: string) =>
    (linesByKey.get(key) ?? []).reduce(
      (sum, l) => sum + (lockedByLine.get(l.id) ?? 0),
      0,
    );

  // What is left to place per key, and whether the stock covers it.
  const assignments: ImportPlan["assignments"] = [];
  const usedByLine = new Map<string, number>();
  const demandByKey = new Map<string, { label: string; qty: number }[]>();
  for (const [label, byKey] of target) {
    for (const [key, qty] of byKey) {
      const extra = qty - (lockedByContainerKey.get(`${label}#${key}`) ?? 0);
      if (
        lockedByContainerKey.has(`${label}#${key}`) ||
        blocked.has(`${label}#${key}`) ||
        extra <= 0
      ) {
        continue;
      }
      demandByKey.set(key, [
        ...(demandByKey.get(key) ?? []),
        { label, qty: extra },
      ]);
    }
  }
  for (const [key, demands] of demandByKey) {
    const lines = linesByKey.get(key)!;
    const available = lines.reduce(
      (sum, l) =>
        sum + Math.max(0, l.dispatchQty - (lockedByLine.get(l.id) ?? 0)),
      0,
    );
    const wanted = demands.reduce((sum, d) => sum + d.qty, 0);
    if (wanted > available) {
      // The row at which the running total for this line passes the stock
      // (confirmed quantities count as already taken).
      let running = 0;
      const crossing = (rowsOfKey.get(key) ?? []).find((r) => {
        running += r.qty;
        return running > available + (lockedTotalOf(key) ?? 0);
      });
      errors.push({
        code: "IMPORT_EXCEEDS_AVAILABLE",
        row: crossing?.row ?? firstRow.get(`#${key}`),
        params: {
          piNumber: lines[0].piNumber,
          materialNum: lines[0].materialNum ?? "—",
          wanted,
          available,
        },
      });
      continue;
    }
    for (const demand of demands) {
      let left = demand.qty;
      for (const line of lines) {
        if (left === 0) break;
        if (lockedPair.has(`${demand.label}#${line.id}`)) continue;
        const free =
          line.dispatchQty -
          (lockedByLine.get(line.id) ?? 0) -
          (usedByLine.get(line.id) ?? 0);
        const take = Math.min(free, left);
        if (take <= 0) continue;
        assignments.push({
          containerLabel: demand.label,
          lineId: line.id,
          qty: take,
        });
        usedByLine.set(line.id, (usedByLine.get(line.id) ?? 0) + take);
        left -= take;
      }
      if (left > 0) {
        // Only the stock on a line already confirmed in this container was
        // left — the same line can't hold a second position there.
        errors.push({
          code: "IMPORT_CONFIRMED_CHANGED",
          row: firstRow.get(`${demand.label}#${key}`),
          params: {
            container: containerParam(demand.label),
            piNumber: lines[0].piNumber,
            materialNum: lines[0].materialNum ?? "—",
            confirmed: lockedByContainerKey.get(`${demand.label}#${key}`) ?? 0,
            file: demand.qty,
          },
        });
      }
    }
  }

  // Loadability: needed outside OK to mix; and no numbered container > 100%.
  const isOkToMixLabel = (label: string) =>
    label === (okToMix?.label ?? OK_TO_MIX);
  const fill = new Map<string, number>();
  for (const container of input.containers) {
    for (const p of container.positions.filter((x) => x.locked)) {
      const line = lineById.get(p.lineId);
      if (line?.loadability) {
        fill.set(
          container.label,
          (fill.get(container.label) ?? 0) + p.qty / line.loadability,
        );
      }
    }
  }
  for (const a of assignments) {
    if (isOkToMixLabel(a.containerLabel)) continue;
    const line = lineById.get(a.lineId)!;
    if (!line.loadability || line.loadability <= 0) {
      errors.push({
        code: "IMPORT_NO_LOADABILITY",
        row: firstRow.get(`${a.containerLabel}#${line.key}`),
        params: {
          container: containerParam(a.containerLabel),
          piNumber: line.piNumber,
          materialNum: line.materialNum ?? "—",
        },
      });
      continue;
    }
    fill.set(
      a.containerLabel,
      (fill.get(a.containerLabel) ?? 0) + a.qty / line.loadability,
    );
  }
  for (const [label, ratio] of fill) {
    if (!isOkToMixLabel(label) && ratio > 1 + 1e-9) {
      errors.push({
        code: "IMPORT_CONTAINER_OVERFILLED",
        row: firstRow.get(label),
        params: {
          container: containerParam(label),
          percent: Math.round(ratio * 1000) / 10,
        },
      });
    }
  }

  errors.sort((a, b) => (a.row ?? Infinity) - (b.row ?? Infinity));
  return {
    errors,
    newContainers: [...newContainers].sort(
      (a, b) => Number(NUMBERED.exec(a)![1]) - Number(NUMBERED.exec(b)![1]),
    ),
    assignments: errors.length ? [] : assignments,
    rowsRead,
  };
}
