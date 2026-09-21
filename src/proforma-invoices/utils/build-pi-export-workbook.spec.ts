import * as ExcelJS from "exceljs";
import { buildPiExportWorkbook } from "./build-pi-export-workbook";
import { ProformaInvoice } from "../proforma-invoice.entity";
import { PiLineItem } from "../../pi-line-items/pi-line-item.entity";
import { PiStatus } from "../enums/pi-status.enum";

function makeLineItem(overrides: Partial<PiLineItem>): PiLineItem {
  return Object.assign(new PiLineItem(), {
    soNumber: null,
    materialNum: null,
    materialDesc: null,
    balanceToBeDelivered: null,
    quantity: null,
    mt: null,
    loadFactor: null,
    loadability: null,
    currentWeekDispatchLoadFactor: null,
    currentWeekDispatchQty: null,
    ...overrides,
  });
}

function makePi(overrides: Partial<ProformaInvoice>): ProformaInvoice {
  return Object.assign(new ProformaInvoice(), {
    piNumber: "100037320",
    totalQty: null,
    qtyPending: null,
    totalContainers: null,
    containersPending: null,
    currentWeekPlanContainers: null,
    currentWeekPlanQty: null,
    isArchivedShipped: false,
    pendingReplacementFileUrl: null,
    signedFileUrl: null,
    piFileUrl: null,
    lineItems: [],
    ...overrides,
  });
}

async function readWorkbookRows(
  workbook: ExcelJS.Workbook,
): Promise<unknown[][]> {
  const buffer = await workbook.xlsx.writeBuffer();
  const readBack = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await readBack.xlsx.load(buffer as any);
  const sheet = readBack.worksheets[0];
  const rows: unknown[][] = [];
  sheet.eachRow((row) => {
    rows.push(row.values as unknown[]);
  });
  return rows;
}

describe("buildPiExportWorkbook", () => {
  it("writes a header block, the line-items table, and a bold totals row", async () => {
    const pi = makePi({
      piFileUrl: "/files/x/download",
      totalQty: "6.00",
      qtyPending: "6.00",
      currentWeekPlanQty: "2.00",
      lineItems: [
        makeLineItem({
          soNumber: "300028231",
          materialNum: "114674",
          materialDesc: "400/55-17.5 FLOTATION T422 14PR TL",
          balanceToBeDelivered: "6.00",
          quantity: "6.00",
          mt: "0.284",
          loadFactor: "0.0299",
          loadability: "212.0000",
          currentWeekDispatchLoadFactor: "0.0299",
          currentWeekDispatchQty: "2.00",
        }),
      ],
    });

    const workbook = buildPiExportWorkbook(pi);
    const rows = await readWorkbookRows(workbook);

    // header block
    expect(rows[0].slice(1)).toEqual(["PI number", "100037320"]);
    expect(rows[1].slice(1)).toEqual([
      "Status",
      PiStatus.MISSING_SIGNED_DOCUMENT,
    ]);

    // table header + data row + totals row are the last 3 rows
    const [headerRow, dataRow, totalsRow] = rows.slice(-3);
    expect(headerRow.slice(1)).toEqual([
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
    ]);
    expect(dataRow.slice(1)).toEqual([
      "114674",
      "400/55-17.5 FLOTATION T422 14PR TL",
      "300028231",
      6,
      6,
      0.284,
      0.0299,
      212,
      0.0299,
      2,
      "—", // no priority set -> dashes, not zeros
      "—",
    ]);
    expect(totalsRow[1]).toBe("Всего");
    expect(totalsRow[4]).toBe(6); // balance
    expect(totalsRow[5]).toBe(6); // quantity
    expect(totalsRow[6]).toBeCloseTo(0.284); // mt
    expect(totalsRow[7]).toBeCloseTo(0.0299); // load factor
    expect(totalsRow[8]).toBeUndefined(); // loadability — dashed, i.e. empty
    expect(totalsRow[9]).toBeCloseTo(0.0299); // cwdp load factor
    expect(totalsRow[10]).toBe(2); // cwdp qty
    expect(totalsRow[11]).toBe("—"); // no priorities at all
    expect(totalsRow[12]).toBe("—");
  });

  describe("priority columns", () => {
    const withPriority = () =>
      makePi({
        totalQty: "300.00",
        qtyPending: "300.00",
        lineItems: [
          makeLineItem({
            materialNum: "A",
            loadability: "200",
            priorityQty: "40.00",
          }),
          makeLineItem({
            materialNum: "B",
            loadability: "100",
            priorityQty: "0.00",
          }),
          makeLineItem({
            materialNum: "C",
            loadability: null,
            priorityQty: "25.00",
          }),
          makeLineItem({
            materialNum: "D",
            loadability: "3",
            priorityQty: "1.00",
          }),
          makeLineItem({
            materialNum: "E",
            loadability: "50",
            priorityQty: "0",
          }),
          makeLineItem({
            materialNum: "F",
            loadability: "0",
            priorityQty: "7.00",
          }),
        ],
      });

    it("appends the two columns after the existing ten, leaving those in place", async () => {
      const rows = await readWorkbookRows(
        buildPiExportWorkbook(withPriority()),
      );
      const headerRow = rows.find((r) => r[1] === "Material Num")!;

      expect(headerRow.slice(1)).toHaveLength(12);
      expect(headerRow.slice(1, 11)).toEqual([
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
      ]);
      expect(headerRow.slice(11)).toEqual([
        "Priority Qty",
        "Priority Load Factor",
      ]);
    });

    it("writes priority qty and qty/loadability to 4 places on priority rows, dashes elsewhere", async () => {
      const rows = await readWorkbookRows(
        buildPiExportWorkbook(withPriority()),
      );
      const byMaterial = new Map(
        rows
          .filter(
            (r) => typeof r[1] === "string" && /^[A-F]$/.test(r[1] as string),
          )
          .map((r) => [r[1] as string, r.slice(11)]),
      );

      expect(byMaterial.get("A")).toEqual([40, 0.2]);
      expect(byMaterial.get("B")).toEqual(["—", "—"]); // priority 0
      expect(byMaterial.get("C")).toEqual([25, "—"]); // no loadability
      expect(byMaterial.get("D")).toEqual([1, 0.3333]); // rounded to 4 places
      expect(byMaterial.get("E")).toEqual(["—", "—"]); // priority "0"
      expect(byMaterial.get("F")).toEqual([7, "—"]); // loadability 0
    });

    it("totals row: the sum of Priority Qty, a dash for Priority Load Factor", async () => {
      const rows = await readWorkbookRows(
        buildPiExportWorkbook(withPriority()),
      );
      const totalsRow = rows[rows.length - 1];

      expect(totalsRow[1]).toBe("Всего");
      expect(totalsRow[11]).toBe(73); // 40 + 25 + 1 + 7
      expect(totalsRow[12]).toBe("—");
    });
  });

  it("sums MT/Load Factor across multiple line items in the totals row", async () => {
    const pi = makePi({
      totalQty: "10.00",
      qtyPending: "10.00",
      currentWeekPlanQty: "0.00",
      lineItems: [
        makeLineItem({ materialNum: "A", mt: "0.100", loadFactor: "0.01" }),
        makeLineItem({ materialNum: "B", mt: "0.200", loadFactor: "0.02" }),
      ],
    });

    const workbook = buildPiExportWorkbook(pi);
    const rows = await readWorkbookRows(workbook);
    const totalsRow = rows[rows.length - 1];

    expect(totalsRow[6]).toBeCloseTo(0.3);
    expect(totalsRow[7]).toBeCloseTo(0.03);
  });
});
