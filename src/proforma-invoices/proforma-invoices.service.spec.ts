import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { makeFakeRepo } from "../common/testing/fake-repo";
import { makeFakeDataSource } from "../common/testing/fake-data-source";
import { FakeAudit, makeFakeAudit } from "../common/testing/fake-audit";
import { ProformaInvoicesService } from "./proforma-invoices.service";
import { ProformaInvoice } from "./proforma-invoice.entity";
import { PiFileType, PiFileVersion } from "./pi-file-version.entity";
import { PiCreatedFrom } from "./enums/pi-created-from.enum";
import { Role } from "../common/enums/role.enum";
import type { RequestUser } from "../common/auth/request-user.interface";

describe("ProformaInvoicesService", () => {
  let repo: ReturnType<typeof makeFakeRepo>;
  let additionalFilesRepo: ReturnType<typeof makeFakeRepo>;
  let lineItemsRepo: ReturnType<typeof makeFakeRepo>;
  let allocationsRepo: ReturnType<typeof makeFakeRepo>;
  let actualLineItemsRepo: ReturnType<typeof makeFakeRepo>;
  let versionsRepo: ReturnType<typeof makeFakeRepo>;
  let usersRepo: ReturnType<typeof makeFakeRepo>;
  let filesService: { save: jest.Mock };
  let customersService: { findFirst: jest.Mock };
  let eventEmitter: { emit: jest.Mock };
  let audit: FakeAudit;
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
    usersRepo = makeFakeRepo();
    for (const [id, email] of [
      ["ops-1", "ops@ceat.com"],
      ["ops-old", "old-ops@ceat.com"],
      ["client-1", "buyer@mtkrosberg.com"],
    ]) {
      usersRepo.seed({ id, email });
    }
    versionsRepo = makeFakeRepo({ uploadedBy: () => usersRepo });
    // Writes that archive a file version run in repo.manager.transaction().
    Object.assign(repo, {
      manager: makeFakeDataSource(
        new Map<unknown, unknown>([
          [ProformaInvoice, repo],
          [PiFileVersion, versionsRepo],
        ]),
      ),
    });
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
    audit = makeFakeAudit();
    service = new ProformaInvoicesService(
      repo as any,
      additionalFilesRepo as any,
      lineItemsRepo as any,
      allocationsRepo as any,
      actualLineItemsRepo as any,
      filesService as any,
      customersService as any,
      eventEmitter as any,
      versionsRepo as any,
      audit as any,
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

  describe("file history (Phase 19)", () => {
    const T0 = new Date("2026-01-01T00:00:00Z");
    const at = (iso: string) => {
      const date = new Date(iso);
      jest.setSystemTime(date);
      return date;
    };

    beforeEach(() => {
      jest.useFakeTimers({ now: T0 });
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    function seedFiledPi() {
      repo.seed({
        id: "pi-1",
        piNumber: "100037320",
        customer: { id: "cust-1" },
        piFileUrl: "/files/original/download",
        piFileUploadedAt: T0,
        piFileUploadedBy: { id: "ops-old" },
        signedFileUrl: null,
        signedFileUploadedAt: null,
        signedFileUploadedBy: null,
        pendingReplacementFileUrl: null,
        pendingReplacementProposedBy: null,
        pendingReplacementProposedAt: null,
      });
    }

    async function replaceOriginal(fileName: string) {
      await service.proposeReplacement("pi-1", file(fileName), opsActor);
      return service.replacementDecision("pi-1", true, clientActor);
    }

    it("a first upload archives nothing — new card, filled-in card, first signed copy", async () => {
      await service.uploadPi(file("100037999.pdf"), opsActor);
      repo.seed({
        id: "pi-backorder",
        piNumber: "100037320",
        piFileUrl: null,
        createdFrom: PiCreatedFrom.BACKORDER_ROW,
        customer: { id: "cust-1" },
      });
      await service.uploadPi(file("100037320.pdf"), opsActor);
      await service.uploadSigned("pi-backorder", file("s.pdf"), clientActor);

      expect(versionsRepo.rows).toHaveLength(0);
      const history = await service.getFileHistory("pi-backorder", opsActor);
      expect(
        history.map((e) => [e.fileType, e.isCurrent, e.replacedAt]),
      ).toEqual([
        [PiFileType.ORIGINAL, true, null],
        [PiFileType.SIGNED, true, null],
      ]);
    });

    it("an approved replacement archives exactly one row: the old original, who/when uploaded it, replacedAt = now", async () => {
      seedFiledPi();
      at("2026-02-01T10:00:00Z");
      await service.proposeReplacement("pi-1", file("repl.pdf"), opsActor);
      const approvedAt = at("2026-02-03T09:00:00Z");
      await service.replacementDecision("pi-1", true, clientActor);

      expect(versionsRepo.rows).toHaveLength(1);
      expect(versionsRepo.rows[0]).toMatchObject({
        pi: { id: "pi-1" },
        fileType: PiFileType.ORIGINAL,
        fileUrl: "/files/original/download",
        uploadedBy: { id: "ops-old" },
        uploadedAt: T0,
        replacedAt: approvedAt,
      });
    });

    it("a rejected replacement archives nothing (the proposal was never current)", async () => {
      seedFiledPi();
      await service.proposeReplacement("pi-1", file("repl.pdf"), opsActor);
      await service.replacementDecision("pi-1", false, clientActor);

      expect(versionsRepo.rows).toHaveLength(0);
    });

    it("a re-uploaded signed copy archives the previous one", async () => {
      seedFiledPi();
      const firstSignedAt = at("2026-02-01T00:00:00Z");
      await service.uploadSigned("pi-1", file("s1.pdf"), clientActor);
      expect(versionsRepo.rows).toHaveLength(0);

      const secondSignedAt = at("2026-02-05T00:00:00Z");
      await service.uploadSigned("pi-1", file("s2.pdf"), clientActor);

      expect(versionsRepo.rows).toHaveLength(1);
      expect(versionsRepo.rows[0]).toMatchObject({
        fileType: PiFileType.SIGNED,
        fileUrl: "/files/file-1/download",
        uploadedBy: { id: "client-1" },
        uploadedAt: firstSignedAt,
        replacedAt: secondSignedAt,
      });
    });

    it("several replacements build the right chain, newest first, only the live files current", async () => {
      seedFiledPi(); // original v0 at T0
      at("2026-02-01T00:00:00Z");
      await service.uploadSigned("pi-1", file("s1.pdf"), clientActor); // file-1
      at("2026-02-10T00:00:00Z");
      await service.proposeReplacement("pi-1", file("o1.pdf"), opsActor); // file-2
      const o1ApprovedAt = at("2026-02-11T00:00:00Z");
      await service.replacementDecision("pi-1", true, clientActor);
      const s2At = at("2026-02-20T00:00:00Z");
      await service.uploadSigned("pi-1", file("s2.pdf"), clientActor); // file-3
      const o2ProposedAt = at("2026-03-01T00:00:00Z");
      await service.proposeReplacement("pi-1", file("o2.pdf"), opsActor); // file-4
      const o2ApprovedAt = at("2026-03-02T00:00:00Z");
      await service.replacementDecision("pi-1", true, clientActor);

      const history = await service.getFileHistory("pi-1", clientActor);

      expect(
        history.map((e) => ({
          type: e.fileType,
          url: e.fileUrl,
          uploadedAt: e.uploadedAt,
          replacedAt: e.replacedAt,
          isCurrent: e.isCurrent,
        })),
      ).toEqual([
        // current original: the second approved proposal, uploaded when proposed
        {
          type: PiFileType.ORIGINAL,
          url: "/files/file-4/download",
          uploadedAt: o2ProposedAt,
          replacedAt: null,
          isCurrent: true,
        },
        // current signed
        {
          type: PiFileType.SIGNED,
          url: "/files/file-3/download",
          uploadedAt: s2At,
          replacedAt: null,
          isCurrent: true,
        },
        // first replacement original, replaced by the second approval
        {
          type: PiFileType.ORIGINAL,
          url: "/files/file-2/download",
          uploadedAt: new Date("2026-02-10T00:00:00Z"),
          replacedAt: o2ApprovedAt,
          isCurrent: false,
        },
        // first signed copy, replaced by the re-upload
        {
          type: PiFileType.SIGNED,
          url: "/files/file-1/download",
          uploadedAt: new Date("2026-02-01T00:00:00Z"),
          replacedAt: s2At,
          isCurrent: false,
        },
        // the very first original, replaced by the first approval
        {
          type: PiFileType.ORIGINAL,
          url: "/files/original/download",
          uploadedAt: T0,
          replacedAt: o1ApprovedAt,
          isCurrent: false,
        },
      ]);
      expect(versionsRepo.rows).toHaveLength(3);
      // archived rows carry the uploader's email for the history list
      expect(
        history.find((e) => e.fileUrl === "/files/original/download")!
          .uploadedBy,
      ).toEqual({ id: "ops-old", email: "old-ops@ceat.com" });
    });

    it("owner-check: another customer's client gets 404, ops sees any card", async () => {
      seedFiledPi();
      await replaceOriginal("repl.pdf");

      await expect(
        service.getFileHistory("pi-1", otherClientActor),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.getFileHistory("no-such-pi", clientActor),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await service.getFileHistory("pi-1", opsActor)).toHaveLength(2);
    });

    it("a foreign client can't write a version either (upload-signed is owner-checked first)", async () => {
      seedFiledPi();
      await expect(
        service.uploadSigned("pi-1", file("x.pdf"), otherClientActor),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(versionsRepo.rows).toHaveLength(0);
    });
  });

  describe("action journal (Phase 20b)", () => {
    function seedCard(overrides: Record<string, unknown> = {}) {
      repo.seed({
        id: "pi-1",
        piNumber: "100037320",
        label: null,
        customer: { id: "cust-1" },
        piFileUrl: "/files/original/download",
        piFileUploadedAt: new Date("2026-01-01T00:00:00Z"),
        piFileUploadedBy: { id: "ops-old" },
        signedFileUrl: null,
        pendingReplacementFileUrl: null,
        pendingReplacementProposedBy: null,
        pendingReplacementProposedAt: null,
        lineItems: [],
        ...overrides,
      });
    }

    it("PI upload — new card and filled-in card — journals pi.file_uploaded", async () => {
      await service.uploadPi(file("100037999.pdf"), opsActor);
      repo.seed({
        id: "pi-bo",
        piNumber: "100037320",
        piFileUrl: null,
        createdFrom: PiCreatedFrom.BACKORDER_ROW,
        customer: { id: "cust-1" },
      });
      await service.uploadPi(file("100037320.pdf"), opsActor);

      expect(audit.entries).toEqual([
        expect.objectContaining({
          actor: opsActor,
          action: "pi.file_uploaded",
          entityType: "pi",
          metadata: expect.objectContaining({
            piNumber: "100037999",
            fileName: "100037999.pdf",
            cardCreated: true,
          }),
          inTransaction: false,
        }),
        expect.objectContaining({
          action: "pi.file_uploaded",
          entityId: "pi-bo",
          metadata: expect.objectContaining({ cardCreated: false }),
          inTransaction: true,
        }),
      ]);
    });

    it("first signed copy is pi.signed, a re-upload pi.signed_file_replaced — both in the transaction", async () => {
      seedCard();
      await service.uploadSigned("pi-1", file("s1.pdf"), clientActor);
      await service.uploadSigned("pi-1", file("s2.pdf"), clientActor);

      expect(audit.entries.map((e) => [e.action, e.inTransaction])).toEqual([
        ["pi.signed", true],
        ["pi.signed_file_replaced", true],
      ]);
      expect(audit.entries[1].metadata).toMatchObject({
        piNumber: "100037320",
        fileName: "s2.pdf",
        previousFileUrl: "/files/file-1/download",
      });
    });

    it("additional file, proposal, approval and rejection are each journaled", async () => {
      seedCard();
      await service.addAdditionalFile(
        "pi-1",
        file("extra.pdf"),
        "customs",
        opsActor,
      );
      await service.proposeReplacement("pi-1", file("r1.pdf"), opsActor);
      await service.replacementDecision("pi-1", true, clientActor);
      await service.proposeReplacement("pi-1", file("r2.pdf"), opsActor);
      await service.replacementDecision("pi-1", false, clientActor);

      expect(audit.actions()).toEqual([
        "pi.additional_file_added",
        "pi.replacement_proposed",
        "pi.replacement_approved",
        "pi.replacement_proposed",
        "pi.replacement_rejected",
      ]);
      expect(audit.entries[0].metadata).toMatchObject({
        fileName: "extra.pdf",
        description: "customs",
      });
      expect(audit.entries[2]).toMatchObject({
        actor: clientActor,
        inTransaction: true,
        metadata: {
          proposedFileUrl: "/files/file-2/download",
          previousFileUrl: "/files/original/download",
        },
      });
    });

    it("label set and cleared are journaled with from/to; an unchanged save is not", async () => {
      seedCard({ piFileUrl: null });
      await service.updateLabel("pi-1", "  Orel  ", clientActor);
      await service.updateLabel("pi-1", "Orel", clientActor); // unchanged
      await service.updateLabel("pi-1", null, clientActor);

      expect(audit.entries.map((e) => [e.action, e.metadata])).toEqual([
        ["pi.label_changed", { piNumber: "100037320", from: null, to: "Orel" }],
        ["pi.label_changed", { piNumber: "100037320", from: "Orel", to: null }],
      ]);
    });

    it("priority reset is journaled with how many lines had a priority", async () => {
      seedCard();
      lineItemsRepo.seed({ id: "li-1", pi: { id: "pi-1" }, priorityQty: "5" });
      lineItemsRepo.seed({ id: "li-2", pi: { id: "pi-1" }, priorityQty: "0" });
      // findOne's relations aren't joined by the fake repo — stitch the lines on.
      repo.rows.find((r) => r.id === "pi-1")!.lineItems = lineItemsRepo.rows;

      await service.resetPriority("pi-1", clientActor);

      expect(audit.entries).toEqual([
        expect.objectContaining({
          action: "pi.priority_reset",
          entityId: "pi-1",
          metadata: { piNumber: "100037320", linesReset: 1 },
        }),
      ]);
    });

    it("a refused action journals nothing", async () => {
      seedCard({ signedFileUrl: "/files/signed/download" });
      await service
        .updateLabel("pi-1", "x", clientActor)
        .catch(() => undefined);
      await service
        .replacementDecision("pi-1", true, clientActor)
        .catch(() => undefined);
      await service
        .uploadSigned("pi-1", file("x.pdf"), otherClientActor)
        .catch(() => undefined);

      expect(audit.entries).toEqual([]);
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
