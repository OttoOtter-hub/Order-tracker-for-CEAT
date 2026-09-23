import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { makeFakeRepo } from "../common/testing/fake-repo";
import { ProformaInvoicesService } from "./proforma-invoices.service";
import { PiCreatedFrom } from "./enums/pi-created-from.enum";
import { Role } from "../common/enums/role.enum";
import type { RequestUser } from "../common/auth/request-user.interface";

describe("ProformaInvoicesService", () => {
  let repo: ReturnType<typeof makeFakeRepo>;
  let additionalFilesRepo: ReturnType<typeof makeFakeRepo>;
  let lineItemsRepo: ReturnType<typeof makeFakeRepo>;
  let allocationsRepo: ReturnType<typeof makeFakeRepo>;
  let actualLineItemsRepo: ReturnType<typeof makeFakeRepo>;
  let filesService: { save: jest.Mock };
  let customersService: { findFirst: jest.Mock };
  let eventEmitter: { emit: jest.Mock };
  let service: ProformaInvoicesService;
  let fileCounter: number;

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
    repo = makeFakeRepo();
    additionalFilesRepo = makeFakeRepo();
    lineItemsRepo = makeFakeRepo();
    allocationsRepo = makeFakeRepo();
    actualLineItemsRepo = makeFakeRepo();
    fileCounter = 1;
    filesService = {
      save: jest.fn(async () => {
        const id = `file-${fileCounter++}`;
        return {
          id,
          originalName: "x.pdf",
          mimeType: "application/pdf",
          sizeBytes: "1",
          storageKey: `${id}.pdf`,
          uploadedBy: "someone",
        };
      }),
    };
    customersService = {
      findFirst: jest.fn(async () => ({
        id: "cust-1",
        name: "MTK ROSBERG LLC",
      })),
    };
    eventEmitter = { emit: jest.fn() };
    service = new ProformaInvoicesService(
      repo as any,
      additionalFilesRepo as any,
      lineItemsRepo as any,
      allocationsRepo as any,
      actualLineItemsRepo as any,
      filesService as any,
      customersService as any,
      eventEmitter as any,
    );
  });

  function file(originalname: string): Express.Multer.File {
    return { originalname } as Express.Multer.File;
  }

  describe("uploadPi — PI number extraction", () => {
    it("400s with a clear message when the filename has no recognizable number", async () => {
      await expect(
        service.uploadPi(file("no-digits-here.pdf"), opsActor),
      ).rejects.toThrow(
        new BadRequestException(
          "не удалось распознать номер PI из имени файла",
        ),
      );
      expect(filesService.save).not.toHaveBeenCalled();
    });

    it("extracts the number ignoring a signed_ prefix", async () => {
      const result = await service.uploadPi(
        file("signed_100037320.pdf"),
        opsActor,
      );
      expect(result.piNumber).toBe("100037320");
    });
  });

  describe("uploadPi — new card", () => {
    it("creates a new card (createdFrom=pi_upload) against the only existing customer", async () => {
      const result = await service.uploadPi(file("100037320.pdf"), opsActor);

      expect(customersService.findFirst).toHaveBeenCalled();
      expect(result.piNumber).toBe("100037320");
      expect(result.createdFrom).toBe(PiCreatedFrom.PI_UPLOAD);
      expect(result.piFileUrl).toBe("/files/file-1/download");
      expect(result.customer).toEqual({
        id: "cust-1",
        name: "MTK ROSBERG LLC",
      });
    });
  });

  describe("uploadPi — dedup", () => {
    it("409s when a card with this number already has a pi_file_url", async () => {
      repo.seed({
        id: "pi-existing",
        piNumber: "100037320",
        piFileUrl: "/files/original/download",
        customer: { id: "cust-1" },
      });

      await expect(
        service.uploadPi(file("100037320.pdf"), opsActor),
      ).rejects.toThrow(
        new ConflictException(
          "проформа с этим номером уже загружена, используйте предложение замены",
        ),
      );
      expect(filesService.save).not.toHaveBeenCalled();
    });
  });

  describe("uploadPi — fills in a backorder_row card", () => {
    it("fills pi_file_url/uploaded_at/uploaded_by on a card with an empty pi_file_url", async () => {
      repo.seed({
        id: "pi-backorder",
        piNumber: "100037320",
        piFileUrl: null,
        createdFrom: PiCreatedFrom.BACKORDER_ROW,
        customer: { id: "cust-1" },
      });

      const result = await service.uploadPi(file("100037320.pdf"), opsActor);

      expect(customersService.findFirst).not.toHaveBeenCalled();
      expect(result.id).toBe("pi-backorder");
      expect(result.createdFrom).toBe(PiCreatedFrom.BACKORDER_ROW);
      expect(result.piFileUrl).toBe("/files/file-1/download");
      expect(result.piFileUploadedBy).toEqual({ id: "ops-1" });
    });
  });

  describe("propose-replacement -> replacement-decision cycle", () => {
    function seedSignedPi() {
      repo.seed({
        id: "pi-1",
        piNumber: "100037320",
        customer: { id: "cust-1" },
        piFileUrl: "/files/original/download",
        piFileUploadedAt: new Date("2026-01-01T00:00:00Z"),
        piFileUploadedBy: { id: "ops-old" },
        pendingReplacementFileUrl: null,
        pendingReplacementProposedBy: null,
        pendingReplacementProposedAt: null,
      });
    }

    it("409s a second proposal while one is already pending", async () => {
      seedSignedPi();
      await service.proposeReplacement("pi-1", file("repl.pdf"), opsActor);

      await expect(
        service.proposeReplacement("pi-1", file("repl2.pdf"), opsActor),
      ).rejects.toThrow(
        new ConflictException(
          "уже есть предложение замены, ожидающее решения клиента",
        ),
      );
    });

    it("approved=true moves the proposed file into pi_file_url and clears the proposal", async () => {
      seedSignedPi();
      const proposed = await service.proposeReplacement(
        "pi-1",
        file("repl.pdf"),
        opsActor,
      );
      expect(proposed.pendingReplacementFileUrl).toBe("/files/file-1/download");

      const decided = await service.replacementDecision(
        "pi-1",
        true,
        clientActor,
      );

      expect(decided.piFileUrl).toBe("/files/file-1/download");
      expect(decided.piFileUploadedBy).toEqual({ id: "ops-1" });
      expect(decided.pendingReplacementFileUrl).toBeNull();
      expect(decided.pendingReplacementProposedBy).toBeNull();
      expect(decided.pendingReplacementProposedAt).toBeNull();
    });

    it("approved=false clears the proposal and leaves pi_file_url untouched", async () => {
      seedSignedPi();
      await service.proposeReplacement("pi-1", file("repl.pdf"), opsActor);

      const decided = await service.replacementDecision(
        "pi-1",
        false,
        clientActor,
      );

      expect(decided.piFileUrl).toBe("/files/original/download");
      expect(decided.pendingReplacementFileUrl).toBeNull();
      expect(decided.pendingReplacementProposedBy).toBeNull();
    });

    it("400s a decision when there is no active proposal", async () => {
      seedSignedPi();
      await expect(
        service.replacementDecision("pi-1", true, clientActor),
      ).rejects.toThrow(
        new BadRequestException(
          "нет активного предложения замены для этого PI",
        ),
      );
    });
  });

  describe("Phase 13 — notification events", () => {
    it("uploadPi (new card) emits pi.ready-to-sign with the customer id", async () => {
      await service.uploadPi(file("100037320.pdf"), opsActor);

      expect(eventEmitter.emit).toHaveBeenCalledWith("pi.ready-to-sign", {
        piNumber: "100037320",
        label: null,
        customerId: "cust-1",
      });
    });

    it("uploadPi (fills a backorder_row card) emits pi.ready-to-sign", async () => {
      repo.seed({
        id: "pi-backorder",
        piNumber: "100037320",
        piFileUrl: null,
        label: "Орел",
        createdFrom: PiCreatedFrom.BACKORDER_ROW,
        customer: { id: "cust-1" },
      });

      await service.uploadPi(file("100037320.pdf"), opsActor);

      expect(eventEmitter.emit).toHaveBeenCalledWith("pi.ready-to-sign", {
        piNumber: "100037320",
        label: "Орел",
        customerId: "cust-1",
      });
    });

    it("proposeReplacement emits pi.replacement-proposed with the customer id", async () => {
      repo.seed({
        id: "pi-1",
        piNumber: "100037320",
        customer: { id: "cust-1" },
        piFileUrl: "/files/original/download",
        pendingReplacementFileUrl: null,
      });

      await service.proposeReplacement("pi-1", file("repl.pdf"), opsActor);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        "pi.replacement-proposed",
        {
          piNumber: "100037320",
          label: null,
          customerId: "cust-1",
        },
      );
    });
  });

  describe("exportXlsx", () => {
    it("returns an xlsx buffer with a filename derived from the PI number", async () => {
      repo.seed({
        id: "pi-1",
        piNumber: "100037320",
        customer: { id: "cust-1" },
        lineItems: [],
      });

      const { buffer, fileName } = await service.exportXlsx("pi-1", opsActor);

      expect(buffer.length).toBeGreaterThan(0);
      expect(fileName).toMatch(/^PI_100037320_export_\d{4}-\d{2}-\d{2}\.xlsx$/);
    });

    it("404s for a client requesting another customer's PI", async () => {
      repo.seed({
        id: "pi-1",
        piNumber: "100037320",
        customer: { id: "someone-elses-customer" },
        lineItems: [],
      });

      await expect(
        service.exportXlsx("pi-1", clientActor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("allows a client to export their own PI", async () => {
      repo.seed({
        id: "pi-1",
        piNumber: "100037320",
        customer: { id: "cust-1" },
        lineItems: [],
      });

      const { fileName } = await service.exportXlsx("pi-1", clientActor);
      expect(fileName).toContain("100037320");
    });
  });

  describe("findOne — reconciliation (Phase 12)", () => {
    it("attaches plan-vs-actual per material, confirmed-only, grouped across SO rows", async () => {
      const li1 = {
        id: "li-1",
        materialNum: "M1",
        materialDesc: "Tyre A",
        soNumber: "SO1",
      };
      const li2 = {
        id: "li-2",
        materialNum: "M1",
        materialDesc: "Tyre A",
        soNumber: "SO2",
      };
      repo.seed({
        id: "pi-1",
        piNumber: "100037320",
        customer: { id: "cust-1" },
        lineItems: [li1, li2],
      });
      allocationsRepo.seed({
        id: "a-1",
        piLineItem: li1,
        isLocked: true,
        allocatedQty: "10",
      });
      allocationsRepo.seed({
        id: "a-2",
        piLineItem: li2,
        isLocked: false, // unlocked — must not count
        allocatedQty: "999",
      });
      actualLineItemsRepo.seed({
        id: "al-1",
        piNumber: "100037320",
        materialNum: "M1",
        quantity: "7",
      });

      const pi = await service.findOne("pi-1");

      expect(pi.reconciliation).toEqual([
        {
          materialNum: "M1",
          materialDesc: "Tyre A",
          plannedQty: 10,
          shippedQty: 7,
          delta: -3,
        },
      ]);
    });

    it("is an empty array for a card with no line items, not undefined", async () => {
      repo.seed({
        id: "pi-1",
        piNumber: "100037320",
        customer: { id: "cust-1" },
        lineItems: [],
      });

      const pi = await service.findOne("pi-1");

      expect(pi.reconciliation).toEqual([]);
    });
  });

  describe("updateLabel", () => {
    function seedPi(overrides: Record<string, unknown> = {}) {
      repo.seed({
        id: "pi-1",
        piNumber: "100037320",
        label: null,
        signedFileUrl: null,
        customer: { id: "cust-1" },
        lineItems: [],
        ...overrides,
      });
    }
    const stored = () => repo.rows.find((r) => r.id === "pi-1")!.label;

    it("lets the client set a label before the PI is signed, and returns the card with it", async () => {
      seedPi();

      const result = await service.updateLabel("pi-1", "Орел", clientActor);

      expect(result.label).toBe("Орел");
      expect(stored()).toBe("Орел");
    });

    it("lets the client change it again while the PI is still unsigned", async () => {
      seedPi({ label: "Орел" });

      await service.updateLabel("pi-1", "Сокол", clientActor);

      expect(stored()).toBe("Сокол");
    });

    it("trims the text; an empty, blank or null label is stored as null", async () => {
      seedPi();

      await service.updateLabel("pi-1", "  Орел ", clientActor);
      expect(stored()).toBe("Орел");

      await service.updateLabel("pi-1", "", clientActor);
      expect(stored()).toBeNull();

      await service.updateLabel("pi-1", "Орел", clientActor);
      await service.updateLabel("pi-1", "   ", clientActor);
      expect(stored()).toBeNull();

      await service.updateLabel("pi-1", "Орел", clientActor);
      await service.updateLabel("pi-1", null, clientActor);
      expect(stored()).toBeNull();
    });

    it("400s once the PI is signed — for a change, a clear, and even when no label was ever set", async () => {
      seedPi({ label: "Орел", signedFileUrl: "/files/s/download" });
      const locked = new BadRequestException(
        "название можно менять только до подписания проформы",
      );

      await expect(
        service.updateLabel("pi-1", "Сокол", clientActor),
      ).rejects.toThrow(locked);
      await expect(
        service.updateLabel("pi-1", null, clientActor),
      ).rejects.toThrow(locked);
      expect(stored()).toBe("Орел");

      repo.rows[0].label = null;
      await expect(
        service.updateLabel("pi-1", "Сокол", clientActor),
      ).rejects.toThrow(locked);
      expect(stored()).toBeNull();
    });

    it("rejects an ops actor with 403 — before signing and after", async () => {
      seedPi();
      await expect(
        service.updateLabel("pi-1", "Орел", opsActor),
      ).rejects.toBeInstanceOf(ForbiddenException);

      repo.rows[0].signedFileUrl = "/files/s/download";
      await expect(
        service.updateLabel("pi-1", "Орел", opsActor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(stored()).toBeNull();
    });

    it("404s for a client whose customer doesn't own the PI, leaving the label alone", async () => {
      seedPi({ label: "Орел" });

      await expect(
        service.updateLabel("pi-1", "Сокол", otherClientActor),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(stored()).toBe("Орел");
    });
  });

  describe("resetPriority", () => {
    function seedPiWithLineItems() {
      const lineItem1 = { id: "li-1", pi: { id: "pi-1" }, priorityQty: "5" };
      const lineItem2 = { id: "li-2", pi: { id: "pi-1" }, priorityQty: "10" };
      lineItemsRepo.seed(lineItem1 as any);
      lineItemsRepo.seed(lineItem2 as any);
      // Same object references in both fakes (not a real join, since the
      // two repos are separate in-memory stores here) so that
      // lineItemsRepo.update's in-place mutation is visible through the
      // PI's own (seeded) lineItems array too — lets the assertions below
      // check the actual returned PI, not just that update() was called.
      repo.seed({
        id: "pi-1",
        piNumber: "100037320",
        customer: { id: "cust-1" },
        lineItems: [lineItem1, lineItem2],
      });
      return { lineItem1, lineItem2 };
    }

    it("zeroes every line item's priorityQty for the PI in a single update call, not one per row", async () => {
      seedPiWithLineItems();

      const result = await service.resetPriority("pi-1", clientActor);

      expect(lineItemsRepo.update).toHaveBeenCalledTimes(1);
      expect(
        (result.lineItems ?? []).every((li) => li.priorityQty === "0"),
      ).toBe(true);
    });

    it("blocks a client whose customer doesn't own the PI, with 404 (not 403)", async () => {
      const { lineItem1 } = seedPiWithLineItems();

      await expect(
        service.resetPriority("pi-1", otherClientActor),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(lineItemsRepo.update).not.toHaveBeenCalled();
      expect(lineItem1.priorityQty).toBe("5");
    });

    it("rejects an ops actor outright — reset is a client-only action", async () => {
      const { lineItem1 } = seedPiWithLineItems();

      await expect(
        service.resetPriority("pi-1", opsActor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(lineItemsRepo.update).not.toHaveBeenCalled();
      expect(lineItem1.priorityQty).toBe("5");
    });
  });
});
