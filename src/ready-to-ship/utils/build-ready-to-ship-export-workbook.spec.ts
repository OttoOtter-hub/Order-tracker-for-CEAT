import * as ExcelJS from "exceljs";
import {
  buildReadyToShipExportRows,
  buildReadyToShipExportWorkbook,
  containerCell,
  OK_TO_MIX,
} from "./build-ready-to-ship-export-workbook";

function allocation(overrides: Record<string, unknown>) {
  return {
    id: "a",
    piLineItemId: "l",
    piId: "p",
    piNumber: "100000001",
    piLabel: null,
    soNumber: "300000001",
    materialNum: "MAT",
    materialDesc: "some tyre",
    loadability: 100,
    allocatedQty: 10,
    fillContribution: 0.1,
    markingFile: null,
    ...overrides,
  } as any;
}

function container(label: string, allocations: unknown[]) {
  return { id: label, label, allocations } as any;
}

function line(overrides: Record<string, unknown>) {
  return {
    piLineItemId: "l",
    piId: "p",
    piNumber: "100000001",
    piLabel: null,
    soNumber: "300000001",
    materialNum: "MAT",
    materialDesc: "some tyre",
    loadability: 100,
    currentWeekDispatchQty: 10,
    allocatedQty: 0,
    remainingQty: 10,
    ...overrides,
  } as any;
}

describe("containerCell", () => {
  it("takes N out of 'Контейнер N' and keeps any other label as it is", () => {
    expect(containerCell("Контейнер 7")).toBe(7);
    expect(containerCell("  контейнер   12 ")).toBe(12);
    expect(containerCell("Special A")).toBe("Special A");
    expect(containerCell("Контейнер 7 (резерв)")).toBe("Контейнер 7 (резерв)");
  });
});

describe("buildReadyToShipExportRows", () => {
  it("makes one row per allocation and one per line with a remainder, from the right fields", () => {
    const rows = buildReadyToShipExportRows({
      containers: [
        container("Контейнер 1", [
          allocation({
            materialNum: "107071",
            materialDesc: "10.0/75-15.3 TL",
            allocatedQty: 30,
            loadability: 50,
            piNumber: "100037320",
            piLabel: "Орел",
            soNumber: "300029159",
          }),
        ]),
      ],
      unallocatedLines: [
        line({
          materialNum: "113972",
          materialDesc: "other tyre",
          remainingQty: 70,
          loadability: 50,
          piNumber: "100037321",
          piLabel: "Сокол",
          soNumber: "300029160",
        }),
      ],
    });

    expect(rows).toEqual([
      {
        container: 1,
        sku: "107071",
        description: "10.0/75-15.3 TL",
        quantity: 30,
        loadFactor: 0.6,
        piNumber: "100037320",
        piLabel: "Орел",
        soNumber: "300029159",
      },
      {
        container: OK_TO_MIX,
        sku: "113972",
        description: "other tyre",
        quantity: 70,
        loadFactor: 1.4,
        piNumber: "100037321",
        piLabel: "Сокол",
        soNumber: "300029160",
      },
    ]);
  });

  it("carries a missing label as null, on both container rows and OK to mix rows", () => {
    const rows = buildReadyToShipExportRows({
      containers: [
        container("Контейнер 1", [allocation({ piLabel: undefined })]),
      ],
      unallocatedLines: [line({ piLabel: undefined })],
    });

    expect(rows.map((r) => r.piLabel)).toEqual([null, null]);
  });

  it("rounds the load factor to 4 places", () => {
    const [row] = buildReadyToShipExportRows({
      containers: [
        container("Контейнер 1", [
          allocation({ allocatedQty: 1, loadability: 3 }),
        ]),
      ],
      unallocatedLines: [],
    });

    expect(row.loadFactor).toBe(0.3333);
  });

  it("orders numbered containers ascending as numbers (2 before 10), other labels after them, OK to mix last", () => {
    const rows = buildReadyToShipExportRows({
      containers: [
        container("Контейнер 10", [allocation({ materialNum: "A" })]),
        container("Special", [allocation({ materialNum: "B" })]),
        container("Контейнер 2", [allocation({ materialNum: "C" })]),
        container("Контейнер 1", [allocation({ materialNum: "D" })]),
      ],
      unallocatedLines: [line({ materialNum: "E" })],
    });

    expect(rows.map((r) => [r.container, r.sku])).toEqual([
      [1, "D"],
      [2, "C"],
      [10, "A"],
      ["Special", "B"],
      [OK_TO_MIX, "E"],
    ]);
  });

  it("orders rows inside a container by PI, then SKU", () => {
    const rows = buildReadyToShipExportRows({
      containers: [
        container("Контейнер 1", [
          allocation({ piNumber: "200", materialNum: "A" }),
          allocation({ piNumber: "100", materialNum: "Z" }),
          allocation({ piNumber: "100", materialNum: "B" }),
        ]),
      ],
      unallocatedLines: [],
    });

    expect(rows.map((r) => [r.piNumber, r.sku])).toEqual([
      ["100", "B"],
      ["100", "Z"],
      ["200", "A"],
    ]);
  });

  it("skips lines with nothing left, and lists a line without loadability as OK to mix with an empty Load Factor", () => {
    const rows = buildReadyToShipExportRows({
      containers: [],
      unallocatedLines: [
        line({ materialNum: "DONE", remainingQty: 0, allocatedQty: 10 }),
        line({ materialNum: "NOLOAD", remainingQty: 7, loadability: null }),
        line({ materialNum: "ZEROLOAD", remainingQty: 3, loadability: 0 }),
      ],
    });

    expect(
      rows.map((r) => [r.sku, r.container, r.quantity, r.loadFactor]),
    ).toEqual([
      ["NOLOAD", OK_TO_MIX, 7, null],
      ["ZEROLOAD", OK_TO_MIX, 3, null],
    ]);
  });

  it("yields nothing for an empty view", () => {
    expect(
      buildReadyToShipExportRows({ containers: [], unallocatedLines: [] }),
    ).toEqual([]);
  });
});

describe("buildReadyToShipExportWorkbook", () => {
  async function reload(workbook: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(
      Buffer.from(await workbook.xlsx.writeBuffer()) as any,
    );
    return loaded;
  }

  it("writes one sheet with the eight headers, then the rows: numbers as numbers, blanks empty", async () => {
    const workbook = await reload(
      buildReadyToShipExportWorkbook({
        containers: [
          container("Контейнер 3", [
            allocation({
              materialNum: "107071",
              allocatedQty: 30,
              loadability: 50,
              piLabel: "Орел",
            }),
          ]),
        ],
        unallocatedLines: [
          line({
            materialNum: "NOLOAD",
            remainingQty: 7,
            loadability: null,
            soNumber: null,
          }),
        ],
      }),
    );

    expect(workbook.worksheets).toHaveLength(1);
    const sheet = workbook.worksheets[0];
    const values = (row: number) =>
      (sheet.getRow(row).values as unknown[]).slice(1);
    expect(values(1)).toEqual([
      "Container",
      "SKU",
      "Description",
      "Quantity",
      "Load Factor",
      "Proforma (PI)",
      "Name",
      "SO",
    ]);
    expect(values(2)).toEqual([
      3,
      "107071",
      "some tyre",
      30,
      0.6,
      "100000001",
      "Орел",
      "300000001",
    ]);
    const noLoad = sheet.getRow(3);
    expect(noLoad.getCell(1).value).toBe("OK to mix");
    expect(noLoad.getCell(4).value).toBe(7);
    expect(noLoad.getCell(5).value).toBeNull();
    expect(noLoad.getCell(7).value).toBeNull(); // no label -> empty cell
    expect(noLoad.getCell(8).value).toBeNull();
    expect(sheet.rowCount).toBe(3);
  });

  it("is just the header row when there is nothing to export", async () => {
    const workbook = await reload(
      buildReadyToShipExportWorkbook({ containers: [], unallocatedLines: [] }),
    );

    expect(workbook.worksheets[0].rowCount).toBe(1);
  });
});
