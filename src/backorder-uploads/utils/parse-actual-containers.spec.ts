import * as ExcelJS from "exceljs";
import {
  buildWeeklyFile,
  containerRow,
  dispatchRow,
  eta15Row,
} from "../testing/weekly-workbook";
import { parseBackorderFile } from "./parse-backorder-file";
import { toDateOrNull, toIdentifierOrNull } from "./cell-values";

describe("cell value helpers", () => {
  it("reads Excel's empty date (1899-12-30) and pre-1900 dates as no date", () => {
    expect(toDateOrNull(new Date(Date.UTC(1899, 11, 30)))).toBeNull();
    expect(toDateOrNull(new Date("2026-04-05T00:00:00Z"))).toBe("2026-04-05");
    expect(toDateOrNull(0)).toBeNull();
    expect(toDateOrNull(null)).toBeNull();
    expect(toDateOrNull("")).toBeNull();
  });

  it("accepts an Excel serial number and ISO / dd.mm.yyyy text, rejects impossible days", () => {
    expect(toDateOrNull(46117)).toBe("2026-04-05");
    expect(toDateOrNull("2026-07-31")).toBe("2026-07-31");
    expect(toDateOrNull("31.07.2026")).toBe("2026-07-31");
    expect(toDateOrNull("2026-02-30")).toBeNull();
    expect(toDateOrNull("soon")).toBeNull();
  });

  it("treats a literal 0 identifier as empty and prints numbers without a decimal tail", () => {
    expect(toIdentifierOrNull(0)).toBeNull();
    expect(toIdentifierOrNull(340287277)).toBe("340287277");
    expect(toIdentifierOrNull(" MV PAPU ")).toBe("MV PAPU");
    expect(toIdentifierOrNull("")).toBeNull();
  });
});

describe("parseBackorderFile — shipped-container sheets", () => {
  it("reads ETD-ETA rows: numbers as text ids, 0 as empty, the zero date as no date", async () => {
    const { buffer } = await buildWeeklyFile({
      containers: [
        containerRow({
          container: "BEAU6469435",
          vessel: "MV PAPU/ PAP0226W",
          etd: "2026-04-05",
          preshipment: 340287277,
          commercial: 9357868246,
        }),
        containerRow({ container: "CAAU6845690", vessel: 0, preshipment: 0 }),
      ],
    });

    const { actualContainers } = await parseBackorderFile(buffer);

    expect(actualContainers.containers).toEqual([
      {
        containerNumber: "BEAU6469435",
        customerCode: "66000402",
        port: "Novorossiysk",
        vesselName: "MV PAPU/ PAP0226W",
        sourceEtd: "2026-04-05",
        sourceEta: null,
        preshipmentInvoice: "340287277",
        commercialInvoiceNumber: "9357868246",
      },
      {
        containerNumber: "CAAU6845690",
        customerCode: "66000402",
        port: "Novorossiysk",
        vesselName: null,
        sourceEtd: "2026-07-01",
        sourceEta: null,
        preshipmentInvoice: null,
        commercialInvoiceNumber: "9357868246",
      },
    ]);
  });

  it("normalises container numbers (trim, upper case) and keeps the last of a repeated one", async () => {
    const { buffer } = await buildWeeklyFile({
      containers: [
        containerRow({ container: " caau6845690 ", vessel: "FIRST" }),
        containerRow({ container: "CAAU6845690", vessel: "SECOND" }),
      ],
    });

    const { actualContainers } = await parseBackorderFile(buffer);

    expect(actualContainers.containers).toHaveLength(1);
    expect(actualContainers.containers[0]).toMatchObject({
      containerNumber: "CAAU6845690",
      vesselName: "SECOND",
    });
  });

  it("reads ETA-15 rows: trimmed B/L, money, empty status cells as null", async () => {
    const { buffer } = await buildWeeklyFile({
      eta15: [
        eta15Row({
          container: "CRSU9167145",
          bl: "ALIN26000843  ",
          value: 2423377.89,
        }),
        eta15Row({
          container: "GESU6835948",
          docs: "Released",
          telex: "2026-09-01",
          payment: "2026-09-10",
        }),
      ],
    });

    const { actualContainers } = await parseBackorderFile(buffer);

    expect(actualContainers.eta15).toEqual([
      {
        containerNumber: "CRSU9167145",
        blNumber: "ALIN26000843",
        currency: "INR",
        invoiceValue: 2423377.89,
        documentsReleaseStatus: "0",
        telexReleaseDate: null,
        paymentReceiptStatus: null,
      },
      {
        containerNumber: "GESU6835948",
        blNumber: "ALIN26000843",
        currency: "INR",
        invoiceValue: 2423377.89,
        documentsReleaseStatus: "Released",
        telexReleaseDate: "2026-09-01",
        paymentReceiptStatus: "2026-09-10",
      },
    ]);
  });

  it("flattens Radial and Bias Dispatch into one list, keeping repeated lines", async () => {
    const { buffer } = await buildWeeklyFile({
      radialDispatch: [
        dispatchRow({
          container: "CAAU6845690",
          pi: 100035541,
          qty: 2,
          material: 106907,
        }),
        dispatchRow({
          container: "CAAU6845690",
          pi: 100035541,
          qty: 2,
          material: 106907,
        }),
      ],
      biasDispatch: [
        dispatchRow({
          container: "CAAU6845690",
          pi: 100035801,
          qty: 20,
          category: "Bias",
        }),
      ],
    });

    const { actualContainers } = await parseBackorderFile(buffer);

    expect(actualContainers.dispatchRows).toHaveLength(3);
    expect(actualContainers.dispatchRows[0]).toEqual({
      containerNumber: "CAAU6845690",
      customerCode: "66000402",
      piNumber: "100035541",
      invoiceNumber: "340287276",
      pgiDate: "2026-03-26",
      materialNum: "106907",
      materialDesc: "some tyre",
      quantity: 2,
      customerOrderRef: "Email dated 06.02.2026",
    });
    expect(actualContainers.dispatchRows.map((r) => r.quantity)).toEqual([
      2, 2, 20,
    ]);
    expect(actualContainers.dispatchRowsSkipped).toBe(0);
  });

  it("drops dispatch rows without a container id or a quantity, and counts them", async () => {
    const { buffer } = await buildWeeklyFile({
      radialDispatch: [
        dispatchRow({ container: "CAAU6845690", pi: 100035541, qty: 2 }),
        dispatchRow({ container: "", pi: 100035541, qty: 5 }),
        dispatchRow({ container: "CAAU6845690", pi: 100035541, qty: NaN }),
      ],
    });

    const { actualContainers } = await parseBackorderFile(buffer);

    expect(actualContainers.dispatchRows).toHaveLength(1);
    expect(actualContainers.dispatchRowsSkipped).toBe(2);
  });

  it("keeps a dispatch line whose PI number is blank (a real shipment, unattributed)", async () => {
    const { buffer } = await buildWeeklyFile({
      radialDispatch: [
        dispatchRow({ container: "CAAU6845690", pi: null, qty: 4 }),
      ],
    });

    const { actualContainers } = await parseBackorderFile(buffer);

    expect(actualContainers.dispatchRows[0]).toMatchObject({
      piNumber: null,
      quantity: 4,
    });
  });

  it("finds the header row when a lone code row sits above it", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("ETD-ETA");
    sheet.addRow([66000402]);
    sheet.addRow(["Customer code", "PORT", "Container No", "ETD"]);
    sheet.addRow([
      66000402,
      "OREL",
      "TEST1234567",
      new Date("2026-05-01T00:00:00Z"),
    ]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const { actualContainers } = await parseBackorderFile(buffer);

    expect(actualContainers.containers).toEqual([
      expect.objectContaining({ containerNumber: "TEST1234567", port: "OREL" }),
    ]);
  });

  it("yields nothing for a workbook without those sheets, and leaves the BO parse alone", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Radial BO");
    sheet.addRow(["MaterialNum", "Quotation", "Quantity"]);
    sheet.addRow(["107071", 100037320, 2]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await parseBackorderFile(buffer);

    expect(result.rows).toHaveLength(1);
    expect(result.actualContainers).toEqual({
      containers: [],
      eta15: [],
      dispatchRows: [],
      dispatchRowsSkipped: 0,
    });
  });
});
