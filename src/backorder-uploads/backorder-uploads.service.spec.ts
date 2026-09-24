import * as ExcelJS from "exceljs";
import { makeFakeRepo } from "../common/testing/fake-repo";
import { makeFakeDataSource } from "../common/testing/fake-data-source";
import { FakeAudit, makeFakeAudit } from "../common/testing/fake-audit";
import { BackorderUploadsService } from "./backorder-uploads.service";
import { BackorderUpload } from "./backorder-upload.entity";
import { BackorderUploadSnapshot } from "./backorder-upload-snapshot.entity";
import { ActualContainersImportService } from "../actual-containers/actual-containers-import.service";
import { ActualContainer } from "../actual-containers/actual-container.entity";
import { ActualContainerLineItem } from "../actual-containers/actual-container-line-item.entity";
import { ProformaInvoice } from "../proforma-invoices/proforma-invoice.entity";
import { PiLineItem } from "../pi-line-items/pi-line-item.entity";
import { PiCreatedFrom } from "../proforma-invoices/enums/pi-created-from.enum";
import { Role } from "../common/enums/role.enum";
import type { RequestUser } from "../common/auth/request-user.interface";

const BO_HEADERS = [
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

async function buildBackorderFile(rows: unknown[][]): Promise<{
  originalname: string;
  buffer: Buffer;
}> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Radial BO");
  sheet.addRow(BO_HEADERS);
  for (const row of rows) {
    sheet.addRow(row);
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return {
    originalname: "2907_MTK_ROSBERG_INR.xlsx",
    buffer: Buffer.from(arrayBuffer),
  };
}

function row(piNumber: number, materialNum: string, overrides: unknown[] = []) {
  return [
    66000402,
    'MTK ROSBERG LLC "INR"',
    300029159,
    materialNum,
    "some tyre",
    2, // Balance To be Delivered
    piNumber, // Quotation
    "Novorossiysk",
    "2026-06-16",
    2, // Quantity
    "PO",
    0.5, // MT
    0.1, // Load Factor
    20, // Loadability
    0.5, // CWDP (MT)
    0.1, // CWDP (Load Factor)
    2, // CWDP (Qty)
    ...overrides,
  ];
}

describe("BackorderUploadsService", () => {
  let backorderRepo: ReturnType<typeof makeFakeRepo>;
  let piRepo: ReturnType<typeof makeFakeRepo>;
  let lineItemsRepo: ReturnType<typeof makeFakeRepo>;
  let customersService: { findFirst: jest.Mock; findAll: jest.Mock };
  let filesService: { save: jest.Mock };
  let allocationRelink: { relink: jest.Mock };
  let audit: FakeAudit;
  let service: BackorderUploadsService;

  const opsActor: RequestUser = {
    id: "ops-1",
    email: "ops@ceat.com",
    role: Role.OPS,
    customerId: null,
  };

  const clientActor: RequestUser = {
    id: "client-1",
    email: "buyer@mtkrosberg.com",
    role: Role.CLIENT,
    customerId: "cust-1",
  };

  const otherClientActor: RequestUser = {
    id: "client-2",
    email: "buyer@othercustomer.com",
    role: Role.CLIENT,
    customerId: "cust-2",
  };

  beforeEach(() => {
    backorderRepo = makeFakeRepo();
    piRepo = makeFakeRepo();
    lineItemsRepo = makeFakeRepo();
    const customer = {
      id: "cust-1",
      name: "MTK ROSBERG LLC",
      customerCode: "66000402",
    };
    customersService = {
      findFirst: jest.fn(async () => customer),
      findAll: jest.fn(async () => [customer]),
    };
    filesService = {
      save: jest.fn(async () => ({ id: "stored-file-1" })),
    };
    allocationRelink = { relink: jest.fn(async () => undefined) };
    audit = makeFakeAudit();
    const dataSource = makeFakeDataSource(
      new Map<unknown, unknown>([
        [BackorderUpload, backorderRepo],
        [ProformaInvoice, piRepo],
        [PiLineItem, lineItemsRepo],
        [BackorderUploadSnapshot, makeFakeRepo()],
        [ActualContainer, makeFakeRepo()],
        [ActualContainerLineItem, makeFakeRepo()],
      ]),
    );
    service = new BackorderUploadsService(
      backorderRepo as any,
      piRepo as any,
      customersService as any,
      filesService as any,
      allocationRelink as any,
      dataSource as any,
      new ActualContainersImportService(customersService as any),
      audit as any,
    );
  });

  it("journals each upload in its transaction: who, file, how many cards", async () => {
    const file = await buildBackorderFile([
      row(100037320, "107071"),
      row(100037321, "107072"),
    ]);

    const upload = await service.upload(file as any, opsActor);

    expect(audit.entries).toEqual([
      expect.objectContaining({
        actor: opsActor,
        action: "backorder.uploaded",
        entityType: "backorder_upload",
        entityId: upload.id,
        inTransaction: true,
        metadata: expect.objectContaining({
          fileName: "2907_MTK_ROSBERG_INR.xlsx",
          rowsProcessed: 2,
          newCardsCreated: 2,
          cardsUpdated: 0,
          cardsArchived: 0,
        }),
      }),
    ]);
  });

  it("creates a new card for a PI number that doesn't exist yet", async () => {
    const file = await buildBackorderFile([row(100037320, "107071")]);

    const upload = await service.upload(file as any, opsActor);

    expect(customersService.findFirst).toHaveBeenCalled();
    expect(upload.newCardsCreated).toBe(1);
    expect(upload.cardsUpdated).toBe(0);
    expect(upload.rowsProcessed).toBe(1);
    expect(upload.fileName).toBe("2907_MTK_ROSBERG_INR.xlsx");

    const created = piRepo.rows.find((r) => r.piNumber === "100037320");
    expect(created).toBeDefined();
    expect(created!.createdFrom).toBe(PiCreatedFrom.BACKORDER_ROW);
    expect(created!.totalQty).toBe("2");
    expect(created!.qtyPending).toBe("2");
    expect(created!.totalContainers).toBe("0.1");

    const lineItems = lineItemsRepo.rows.filter(
      (li) => li.pi.id === created!.id,
    );
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0].materialNum).toBe("107071");
  });

  it("does not create a second card, and does not call customersService, for a PI that already exists", async () => {
    piRepo.seed({
      id: "existing-pi",
      piNumber: "100037320",
      customer: { id: "cust-1" },
      createdFrom: PiCreatedFrom.PI_UPLOAD,
      piFileUrl: "/files/x/download",
    });
    const file = await buildBackorderFile([row(100037320, "107071")]);

    const upload = await service.upload(file as any, opsActor);

    expect(customersService.findFirst).not.toHaveBeenCalled();
    expect(upload.newCardsCreated).toBe(0);
    expect(upload.cardsUpdated).toBe(1);
    expect(piRepo.rows.filter((r) => r.piNumber === "100037320")).toHaveLength(
      1,
    );
    // createdFrom of an already-existing card is never overwritten
    expect(piRepo.rows[0].createdFrom).toBe(PiCreatedFrom.PI_UPLOAD);
  });

  it("replaces a card's line items wholesale on re-upload instead of accumulating duplicates", async () => {
    const firstUploadFile = await buildBackorderFile([
      row(100037320, "107071"),
      row(100037320, "113972"),
    ]);
    await service.upload(firstUploadFile as any, opsActor);
    const pi = piRepo.rows.find((r) => r.piNumber === "100037320")!;
    expect(lineItemsRepo.rows.filter((li) => li.pi.id === pi.id)).toHaveLength(
      2,
    );

    // Re-upload with only one of the two materials still open.
    const secondUploadFile = await buildBackorderFile([
      row(100037320, "107071"),
    ]);
    const secondUpload = await service.upload(
      secondUploadFile as any,
      opsActor,
    );

    expect(secondUpload.newCardsCreated).toBe(0);
    const finalLineItems = lineItemsRepo.rows.filter(
      (li) => li.pi.id === pi.id,
    );
    expect(finalLineItems).toHaveLength(1);
    expect(finalLineItems[0].materialNum).toBe("107071");
  });

  it("re-points ready-to-ship allocations at the new rows before deleting the old ones, and leaves other cards' rows alone", async () => {
    await service.upload(
      (await buildBackorderFile([
        row(100037320, "107071"),
        row(100037321, "X-MAT"),
      ])) as any,
      opsActor,
    );
    const pi = piRepo.rows.find((r) => r.piNumber === "100037320")!;
    const otherPi = piRepo.rows.find((r) => r.piNumber === "100037321")!;
    const oldItem = lineItemsRepo.rows.find((li) => li.pi.id === pi.id)!;
    const otherCardItem = lineItemsRepo.rows.find(
      (li) => li.pi.id === otherPi.id,
    )!;
    allocationRelink.relink.mockClear();

    // The relink must run while the old rows still exist — it's what lets
    // the FK from allocations to line items survive the delete that follows.
    allocationRelink.relink.mockImplementationOnce(
      async (oldItems: any[], newItems: any[]) => {
        expect(oldItems.map((i) => i.id)).toEqual([oldItem.id]);
        expect(newItems).toHaveLength(1);
        expect(newItems[0].id).not.toBe(oldItem.id);
        expect(lineItemsRepo.rows.some((li) => li.id === oldItem.id)).toBe(
          true,
        );
      },
    );

    await service.upload(
      (await buildBackorderFile([
        row(100037320, "107071"),
        row(100037321, "X-MAT"),
      ])) as any,
      opsActor,
    );

    expect(allocationRelink.relink).toHaveBeenCalledTimes(2); // once per card in the file
    expect(lineItemsRepo.rows.some((li) => li.id === oldItem.id)).toBe(false);
    expect(lineItemsRepo.rows.some((li) => li.id === otherCardItem.id)).toBe(
      false,
    );
    expect(lineItemsRepo.rows.filter((li) => li.pi.id === pi.id)).toHaveLength(
      1,
    );
    expect(
      lineItemsRepo.rows.filter((li) => li.pi.id === otherPi.id),
    ).toHaveLength(1);
  });

  it("groups rows under the same PI into one card with multiple line items", async () => {
    const file = await buildBackorderFile([
      row(100037320, "107071"),
      row(100037320, "113972"),
    ]);

    const upload = await service.upload(file as any, opsActor);

    expect(upload.newCardsCreated).toBe(1);
    expect(upload.rowsProcessed).toBe(2);
    const pi = piRepo.rows.find((r) => r.piNumber === "100037320")!;
    expect(pi.totalQty).toBe("4"); // 2 rows x quantity 2
    expect(lineItemsRepo.rows.filter((li) => li.pi.id === pi.id)).toHaveLength(
      2,
    );
  });

  it("archives a card that drops out of a later upload, then un-archives it if it reappears", async () => {
    // Upload A: creates X, Y, Z.
    const uploadA = await buildBackorderFile([
      row(100037001, "X-MAT"),
      row(100037002, "Y-MAT"),
      row(100037003, "Z-MAT"),
    ]);
    const resultA = await service.upload(uploadA as any, opsActor);
    expect(resultA.newCardsCreated).toBe(3);
    expect(resultA.cardsArchived).toBe(0);
    const cardZ = () => piRepo.rows.find((r) => r.piNumber === "100037003")!;
    expect(cardZ().isArchivedShipped).toBe(false);

    // Upload B: only X and Y — Z has shipped and dropped off the backorder.
    const uploadB = await buildBackorderFile([
      row(100037001, "X-MAT"),
      row(100037002, "Y-MAT"),
    ]);
    const resultB = await service.upload(uploadB as any, opsActor);
    expect(resultB.newCardsCreated).toBe(0);
    expect(resultB.cardsUpdated).toBe(2);
    expect(resultB.cardsArchived).toBe(1);
    expect(cardZ().isArchivedShipped).toBe(true);
    // X and Y are untouched by the archive sweep.
    expect(
      piRepo.rows.find((r) => r.piNumber === "100037001")!.isArchivedShipped,
    ).toBe(false);

    // Upload C: Z is back — un-archive it, don't re-count it as "new".
    const uploadC = await buildBackorderFile([
      row(100037001, "X-MAT"),
      row(100037002, "Y-MAT"),
      row(100037003, "Z-MAT"),
    ]);
    const resultC = await service.upload(uploadC as any, opsActor);
    expect(resultC.newCardsCreated).toBe(0);
    expect(resultC.cardsArchived).toBe(0);
    expect(cardZ().isArchivedShipped).toBe(false);
  });

  it("does not archive already-archived cards a second time, or count them in cardsArchived", async () => {
    piRepo.seed({
      id: "already-archived",
      piNumber: "100037999",
      customer: { id: "cust-1" },
      createdFrom: PiCreatedFrom.BACKORDER_ROW,
      isArchivedShipped: true,
    });
    const file = await buildBackorderFile([row(100037320, "107071")]);

    const upload = await service.upload(file as any, opsActor);

    expect(upload.cardsArchived).toBe(0);
    expect(
      piRepo.rows.find((r) => r.piNumber === "100037999")!.isArchivedShipped,
    ).toBe(true);
  });

  it("reports skipped rows (material number present, PI number unreadable) in the response", async () => {
    const file = await buildBackorderFile([
      row(100037320, "107071"),
      row(0, "108000").map((v, i) => (i === 6 ? null : v)), // blank out Quotation
    ]);

    const upload = await service.upload(file as any, opsActor);

    expect(upload.rowsProcessed).toBe(1);
    expect(upload.cardsSkippedInvalidRows).toBe(1);
  });

  it("stores the raw uploaded file with the upload date stamped into its name", async () => {
    const file = await buildBackorderFile([row(100037320, "107071")]);

    await service.upload(file as any, opsActor);

    expect(filesService.save).toHaveBeenCalledTimes(1);
    const [savedFile, uploadedById] = filesService.save.mock.calls[0];
    expect(savedFile.originalname).toMatch(
      /^2907_MTK_ROSBERG_INR_\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
    expect(uploadedById).toBe(opsActor.id);
  });

  describe("priorityQty carry-over on re-upload", () => {
    // row()'s SalesOrderNum (index 2) is always 300029159 — override just
    // Balance To be Delivered (index 5) to exercise the shrunk-balance
    // clamp scenario from the task.
    function rowWithBalance(
      piNumber: number,
      materialNum: string,
      balance: number,
    ) {
      return row(piNumber, materialNum).map((v, i) => (i === 5 ? balance : v));
    }

    it("clamps a carried-over priority down when the new balance is smaller than the old priority", async () => {
      const uploadA = await buildBackorderFile([
        rowWithBalance(100037320, "107071", 10),
      ]);
      await service.upload(uploadA as any, opsActor);

      const pi = piRepo.rows.find((r) => r.piNumber === "100037320")!;
      const lineItemA = lineItemsRepo.rows.find((li) => li.pi.id === pi.id)!;
      expect(lineItemA.priorityQty).toBe("0"); // nothing to carry the first time
      // Simulate a prior client priority-set action (that's
      // PiLineItemsService.updatePriority's job, out of scope here) —
      // directly set what would already be in the DB going into upload B.
      lineItemA.priorityQty = "8";

      const uploadB = await buildBackorderFile([
        rowWithBalance(100037320, "107071", 3), // balance shrank below 8
      ]);
      await service.upload(uploadB as any, opsActor);

      const lineItemB = lineItemsRepo.rows.find((li) => li.pi.id === pi.id)!;
      expect(lineItemB.balanceToBeDelivered).toBe("3");
      expect(lineItemB.priorityQty).toBe("3"); // clamped, not the stale 8
    });

    it("carries a priority over unchanged when the new balance still covers it", async () => {
      const uploadA = await buildBackorderFile([
        rowWithBalance(100037320, "107071", 10),
      ]);
      await service.upload(uploadA as any, opsActor);
      const pi = piRepo.rows.find((r) => r.piNumber === "100037320")!;
      lineItemsRepo.rows.find((li) => li.pi.id === pi.id)!.priorityQty = "6";

      const uploadB = await buildBackorderFile([
        rowWithBalance(100037320, "107071", 9), // still >= 6
      ]);
      await service.upload(uploadB as any, opsActor);

      const lineItemB = lineItemsRepo.rows.find((li) => li.pi.id === pi.id)!;
      expect(lineItemB.priorityQty).toBe("6");
    });

    it("starts a new (materialNum, soNumber) pair at priority 0 even if other rows on the same card carried one over", async () => {
      const uploadA = await buildBackorderFile([
        rowWithBalance(100037320, "107071", 10),
      ]);
      await service.upload(uploadA as any, opsActor);
      const pi = piRepo.rows.find((r) => r.piNumber === "100037320")!;
      lineItemsRepo.rows.find((li) => li.pi.id === pi.id)!.priorityQty = "7";

      // Upload B replaces the material entirely — no (materialNum,
      // soNumber) match against the old snapshot.
      const uploadB = await buildBackorderFile([
        rowWithBalance(100037320, "999999", 5),
      ]);
      await service.upload(uploadB as any, opsActor);

      const lineItemB = lineItemsRepo.rows.find((li) => li.pi.id === pi.id)!;
      expect(lineItemB.materialNum).toBe("999999");
      expect(lineItemB.priorityQty).toBe("0");
    });
  });

  describe("exportXlsx", () => {
    it("includes only active (non-archived) cards' line items", async () => {
      piRepo.seed({
        id: "pi-active",
        piNumber: "100037320",
        isArchivedShipped: false,
        lineItems: [{ id: "li-1", materialNum: "ACTIVE" }],
      });
      piRepo.seed({
        id: "pi-archived",
        piNumber: "100037999",
        isArchivedShipped: true,
        lineItems: [{ id: "li-2", materialNum: "ARCHIVED" }],
      });

      const { fileName } = await service.exportXlsx(opsActor);

      expect(fileName).toMatch(
        /^Backorder_source_.+_export_\d{4}-\d{2}-\d{2}\.xlsx$/,
      );
    });

    it("uses the most recent BackorderUpload's date as the source date in the filename", async () => {
      backorderRepo.seed({
        id: "upload-1",
        uploadedAt: new Date("2026-08-20T00:00:00Z"),
      });
      backorderRepo.seed({
        id: "upload-2",
        uploadedAt: new Date("2026-09-01T15:51:00Z"),
      });

      const { fileName } = await service.exportXlsx(opsActor);

      expect(fileName).toContain("Backorder_source_2026-09-01_export_");
    });

    it("ops gets every active card, unscoped by customer", async () => {
      piRepo.seed({
        id: "pi-cust-1",
        piNumber: "100037320",
        isArchivedShipped: false,
        customer: { id: "cust-1" },
        lineItems: [{ id: "li-1", materialNum: "CUST1-MAT" }],
      });
      piRepo.seed({
        id: "pi-cust-2",
        piNumber: "100037321",
        isArchivedShipped: false,
        customer: { id: "cust-2" },
        lineItems: [{ id: "li-2", materialNum: "CUST2-MAT" }],
      });

      const { buffer } = await service.exportXlsx(opsActor);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const materials = extractColumn(workbook, "Material Num");

      expect(materials).toEqual(
        expect.arrayContaining(["CUST1-MAT", "CUST2-MAT"]),
      );
    });

    it("client only gets active cards belonging to their own customer_id", async () => {
      piRepo.seed({
        id: "pi-cust-1",
        piNumber: "100037320",
        isArchivedShipped: false,
        customer: { id: "cust-1" },
        lineItems: [{ id: "li-1", materialNum: "CUST1-MAT" }],
      });
      piRepo.seed({
        id: "pi-cust-2",
        piNumber: "100037321",
        isArchivedShipped: false,
        customer: { id: "cust-2" },
        lineItems: [{ id: "li-2", materialNum: "CUST2-MAT" }],
      });

      const { buffer: bufferForClient1 } =
        await service.exportXlsx(clientActor);
      const workbookForClient1 = new ExcelJS.Workbook();
      await workbookForClient1.xlsx.load(bufferForClient1 as any);
      expect(extractColumn(workbookForClient1, "Material Num")).toEqual([
        "CUST1-MAT",
      ]);

      const { buffer: bufferForClient2 } =
        await service.exportXlsx(otherClientActor);
      const workbookForClient2 = new ExcelJS.Workbook();
      await workbookForClient2.xlsx.load(bufferForClient2 as any);
      expect(extractColumn(workbookForClient2, "Material Num")).toEqual([
        "CUST2-MAT",
      ]);
    });
  });
});

function extractColumn(
  workbook: ExcelJS.Workbook,
  headerLabel: string,
): unknown[] {
  const sheet = workbook.worksheets[0];
  const rows: unknown[][] = [];
  sheet.eachRow((row) => {
    rows.push(row.values as unknown[]);
  });
  const headerRow = rows.find((r) => r.includes(headerLabel));
  if (!headerRow) {
    throw new Error(`header "${headerLabel}" not found`);
  }
  const colIndex = headerRow.indexOf(headerLabel);
  const headerRowIndex = rows.indexOf(headerRow);
  return rows.slice(headerRowIndex + 1).map((r) => r[colIndex]);
}
