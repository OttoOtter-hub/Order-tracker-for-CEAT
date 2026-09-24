import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { Role } from "../common/enums/role.enum";
import type { RequestUser } from "../common/auth/request-user.interface";
import { makeFakeRepo } from "../common/testing/fake-repo";
import { makeFakeAudit } from "../common/testing/fake-audit";
import { ActualContainersService } from "./actual-containers.service";
import { AddContainerFileDto } from "./dto/add-container-file.dto";
import { UpdateContainerDatesDto } from "./dto/update-container-dates.dto";

const ops: RequestUser = {
  id: "ops-1",
  email: "o@ceat.com",
  role: Role.OPS,
  customerId: null,
};
const client: RequestUser = {
  id: "c-1",
  email: "c@x.com",
  role: Role.CLIENT,
  customerId: "cust-1",
};
const otherClient: RequestUser = {
  id: "c-2",
  email: "d@y.com",
  role: Role.CLIENT,
  customerId: "cust-2",
};
const orphanClient: RequestUser = {
  id: "c-3",
  email: "e@z.com",
  role: Role.CLIENT,
  customerId: null,
};

function setup() {
  const containerRepo = makeFakeRepo();
  const fileRepo = makeFakeRepo();
  const lineRepo = makeFakeRepo();
  const filesService = {
    save: jest.fn(async (file: { originalname: string }) => ({
      id: "stored-1",
      originalName: file.originalname,
    })),
    openStoredFile: jest.fn(async (id: string) => ({
      file: { id },
      stream: {},
    })),
  };
  // Stand-in for the relations the real repo joins: lineItems, files, files.uploadedBy.
  const withRelations = {
    ...containerRepo,
    find: async (options: {
      where: Record<string, any>;
      relations?: string[];
    }) =>
      (await containerRepo.find({ where: options.where })).map((row) => ({
        ...row,
        ...(options.relations?.includes("files")
          ? {
              files: fileRepo.rows.filter(
                (f) => f.actualContainer.id === row.id,
              ),
            }
          : {}),
      })),
    findOne: async (options: { where: Record<string, any> }) => {
      const row = await containerRepo.findOne({ where: options.where });
      return row
        ? {
            ...row,
            lineItems: lineRepo.rows.filter(
              (l) => l.actualContainer.id === row.id,
            ),
            files: fileRepo.rows.filter((f) => f.actualContainer.id === row.id),
          }
        : null;
    },
  };
  const filesWithContainer = {
    ...fileRepo,
    findOne: async (options: { where: Record<string, any> }) => {
      const row = await fileRepo.findOne({ where: options.where });
      if (!row) return null;
      const container = containerRepo.rows.find(
        (c) => c.id === row.actualContainer.id,
      );
      return { ...row, actualContainer: container };
    },
  };
  const audit = makeFakeAudit();
  const service = new ActualContainersService(
    withRelations as any,
    filesWithContainer as any,
    filesService as any,
    audit as any,
  );
  containerRepo.seed({
    id: "ct-1",
    containerNumber: "AAAA1111111",
    customer: { id: "cust-1" },
    sourceEtd: "2026-04-05",
    sourceEta: "2026-05-20",
    overrideEtd: null,
    overrideEta: null,
  });
  containerRepo.seed({
    id: "ct-2",
    containerNumber: "BBBB2222222",
    customer: { id: "cust-2" },
    sourceEtd: "2026-06-01",
    sourceEta: null,
    overrideEtd: null,
    overrideEta: null,
  });
  return { service, containerRepo, fileRepo, lineRepo, filesService, audit };
}

describe("ActualContainersService", () => {
  describe("scoping", () => {
    it("ops sees every container, a client only their own customer's", async () => {
      const { service } = setup();

      expect(
        (await service.findAll(ops)).map((c) => c.containerNumber).sort(),
      ).toEqual(["AAAA1111111", "BBBB2222222"]);
      expect(
        (await service.findAll(client)).map((c) => c.containerNumber),
      ).toEqual(["AAAA1111111"]);
      expect(
        (await service.findAll(otherClient)).map((c) => c.containerNumber),
      ).toEqual(["BBBB2222222"]);
    });

    it("a client with no customer sees nothing at all, not everything", async () => {
      const { service } = setup();

      expect(await service.findAll(orphanClient)).toEqual([]);
      await expect(
        service.findOne("ct-1", orphanClient),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("404s a container of another customer, exactly like a missing one", async () => {
      const { service } = setup();

      await expect(service.findOne("ct-2", client)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.findOne("missing", client)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.findOne("ct-2", ops)).resolves.toMatchObject({
        id: "ct-2",
      });
    });

    it("lists newest effective ETD first — the override counts — with undated ones last", async () => {
      const { service, containerRepo } = setup();
      containerRepo.seed({
        id: "ct-3",
        containerNumber: "CCCC3333333",
        customer: { id: "cust-1" },
        sourceEtd: null,
        overrideEtd: null,
      });
      containerRepo.seed({
        id: "ct-4",
        containerNumber: "DDDD4444444",
        customer: { id: "cust-1" },
        sourceEtd: "2026-01-01",
        overrideEtd: "2026-09-01",
      });

      const order = (await service.findAll(ops)).map((c) => c.containerNumber);

      expect(order).toEqual([
        "DDDD4444444",
        "BBBB2222222",
        "AAAA1111111",
        "CCCC3333333",
      ]);
    });

    it("returns line items ordered by PI, invoice, material and files newest first", async () => {
      const { service, lineRepo, fileRepo } = setup();
      const inContainer = { id: "ct-1" };
      lineRepo.seed({
        id: "l1",
        actualContainer: inContainer,
        piNumber: "200",
        invoiceNumber: "1",
        materialNum: "9",
      });
      lineRepo.seed({
        id: "l2",
        actualContainer: inContainer,
        piNumber: "100",
        invoiceNumber: "2",
        materialNum: "5",
      });
      lineRepo.seed({
        id: "l3",
        actualContainer: inContainer,
        piNumber: "100",
        invoiceNumber: "1",
        materialNum: "7",
      });
      fileRepo.seed({
        id: "f-old",
        actualContainer: inContainer,
        uploadedAt: new Date("2026-01-01"),
      });
      fileRepo.seed({
        id: "f-new",
        actualContainer: inContainer,
        uploadedAt: new Date("2026-02-01"),
      });

      const detail = await service.findOne("ct-1", client);

      expect(detail.lineItems.map((l) => l.id)).toEqual(["l3", "l2", "l1"]);
      expect(detail.files.map((f) => f.id)).toEqual(["f-new", "f-old"]);
    });
  });

  describe("dates", () => {
    it("sets one override without touching the other or the file's dates", async () => {
      const { service, containerRepo } = setup();

      await service.updateDates("ct-1", { overrideEtd: "2026-04-12" }, ops);

      expect(containerRepo.rows[0]).toMatchObject({
        overrideEtd: "2026-04-12",
        overrideEta: null,
        sourceEtd: "2026-04-05",
        sourceEta: "2026-05-20",
      });
    });

    it("null clears just that override; the other stays", async () => {
      const { service, containerRepo } = setup();
      await service.updateDates(
        "ct-1",
        { overrideEtd: "2026-04-12", overrideEta: "2026-06-01" },
        ops,
      );

      await service.updateDates("ct-1", { overrideEtd: null }, ops);

      expect(containerRepo.rows[0]).toMatchObject({
        overrideEtd: null,
        overrideEta: "2026-06-01",
      });
    });

    it("rejects an empty body", async () => {
      const { service } = setup();

      await expect(service.updateDates("ct-1", {}, ops)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("404s a missing container without writing anything", async () => {
      const { service, containerRepo } = setup();

      await expect(
        service.updateDates("missing", { overrideEtd: "2026-04-12" }, ops),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(containerRepo.update).not.toHaveBeenCalled();
    });

    it("reset-dates clears both overrides and leaves the file's dates", async () => {
      const { service, containerRepo } = setup();
      await service.updateDates(
        "ct-1",
        { overrideEtd: "2026-04-12", overrideEta: "2026-06-01" },
        ops,
      );

      await service.resetDates("ct-1", ops);

      expect(containerRepo.rows[0]).toMatchObject({
        overrideEtd: null,
        overrideEta: null,
        sourceEtd: "2026-04-05",
        sourceEta: "2026-05-20",
      });
    });

    describe("body validation", () => {
      const check = async (body: object) =>
        (await validate(plainToInstance(UpdateContainerDatesDto, body))).length;

      it("accepts a real calendar date, null and omission", async () => {
        expect(await check({ overrideEtd: "2026-09-25" })).toBe(0);
        expect(await check({ overrideEta: null })).toBe(0);
        expect(await check({})).toBe(0);
      });

      it("rejects an impossible day, a datetime and free text", async () => {
        expect(await check({ overrideEtd: "2026-02-30" })).toBeGreaterThan(0);
        expect(
          await check({ overrideEta: "2026-09-25T10:00:00Z" }),
        ).toBeGreaterThan(0);
        expect(await check({ overrideEtd: "next week" })).toBeGreaterThan(0);
      });
    });
  });

  describe("confirmArrival", () => {
    it("the owning client confirms once: sets arrivalConfirmedAt and arrivalConfirmedByUser", async () => {
      // The fake repo hands back plain objects, not real ActualContainer
      // instances, so arrivalStatus (a getter on the class) isn't
      // exercisable here — that boundary logic has its own dedicated spec,
      // actual-container.entity.spec.ts. This checks what the service
      // actually writes and returns: the two stored fields.
      const { service, containerRepo } = setup();

      const result = await service.confirmArrival("ct-1", client);

      expect(result.arrivalConfirmedAt).toBeInstanceOf(Date);
      expect(result.arrivalConfirmedByUser).toEqual({ id: client.id });
      expect(containerRepo.rows[0].arrivalConfirmedAt).toBeInstanceOf(Date);
      expect(containerRepo.rows[0].arrivalConfirmedByUser).toEqual({
        id: client.id,
      });
    });

    it("400s a second confirmation, without touching the first one's timestamp", async () => {
      const { service, containerRepo } = setup();
      await service.confirmArrival("ct-1", client);
      const firstConfirmedAt = containerRepo.rows[0].arrivalConfirmedAt;

      await expect(service.confirmArrival("ct-1", client)).rejects.toThrow(
        new BadRequestException("прибытие уже подтверждено"),
      );
      expect(containerRepo.rows[0].arrivalConfirmedAt).toBe(firstConfirmedAt);
    });

    it("404s another customer's client (owner-check), leaving the container unconfirmed", async () => {
      const { service, containerRepo } = setup();

      await expect(
        service.confirmArrival("ct-1", otherClient),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(containerRepo.rows[0].arrivalConfirmedAt).toBeUndefined();
    });

    it("rejects ops outright — confirming arrival is a client-only action", async () => {
      const { service, containerRepo } = setup();

      await expect(service.confirmArrival("ct-1", ops)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(containerRepo.rows[0].arrivalConfirmedAt).toBeUndefined();
    });

    it("404s an unknown container", async () => {
      const { service } = setup();

      await expect(
        service.confirmArrival("missing", client),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("revokeArrivalConfirmation", () => {
    it("clears a manual confirmation back to null (both fields)", async () => {
      const { service, containerRepo } = setup();
      await service.confirmArrival("ct-1", client);

      const result = await service.revokeArrivalConfirmation("ct-1", ops);

      expect(result.arrivalConfirmedAt).toBeNull();
      expect(result.arrivalConfirmedByUser).toBeNull();
      expect(containerRepo.rows[0].arrivalConfirmedAt).toBeNull();
      expect(containerRepo.rows[0].arrivalConfirmedByUser).toBeNull();
    });

    it("400s when there is no manual confirmation to revoke", async () => {
      const { service } = setup();

      await expect(
        service.revokeArrivalConfirmation("ct-1", ops),
      ).rejects.toThrow(
        new BadRequestException("прибытие не было подтверждено"),
      );
    });

    it("400s a second revoke", async () => {
      const { service } = setup();
      await service.confirmArrival("ct-1", client);
      await service.revokeArrivalConfirmation("ct-1", ops);

      await expect(
        service.revokeArrivalConfirmation("ct-1", ops),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("403s a client, leaving the confirmation in place", async () => {
      const { service, containerRepo } = setup();
      await service.confirmArrival("ct-1", client);

      await expect(
        service.revokeArrivalConfirmation("ct-1", client),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(containerRepo.rows[0].arrivalConfirmedAt).toBeInstanceOf(Date);
    });

    it("404s an unknown container", async () => {
      const { service } = setup();

      await expect(
        service.revokeArrivalConfirmation("missing", ops),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("files", () => {
    const upload = {
      originalname: "packing list.pdf",
      mimetype: "application/pdf",
      size: 3,
      buffer: Buffer.from("abc"),
    };

    it("the list carries filesCount per container — 0 without files, N with — and not the files themselves", async () => {
      const { service, fileRepo } = setup();
      await service.addFile("ct-1", upload as any, undefined, ops);
      await service.addFile("ct-1", upload as any, "second", ops);
      expect(fileRepo.rows).toHaveLength(2);

      const list = await service.findAll(ops);
      const byNumber = Object.fromEntries(
        list.map((c) => [c.containerNumber, c]),
      );

      expect(byNumber.AAAA1111111.filesCount).toBe(2);
      expect(byNumber.BBBB2222222.filesCount).toBe(0);
      expect(list.every((c) => c.files === undefined)).toBe(true);
    });

    it("the count follows a removal, back to 0 (so the row stops being highlighted)", async () => {
      const { service, fileRepo } = setup();
      await service.addFile("ct-1", upload as any, undefined, ops);
      expect((await service.findAll(client))[0].filesCount).toBe(1);

      await service.removeFile(fileRepo.rows[0].id!, ops);

      expect(
        (await service.findAll(ops)).every((c) => c.filesCount === 0),
      ).toBe(true);
    });

    it("counts a client's files only for their own customer's containers", async () => {
      const { service } = setup();
      await service.addFile("ct-1", upload as any, undefined, ops);

      expect(
        (await service.findAll(client)).map((c) => [
          c.containerNumber,
          c.filesCount,
        ]),
      ).toEqual([["AAAA1111111", 1]]);
      expect(
        (await service.findAll(otherClient)).map((c) => [
          c.containerNumber,
          c.filesCount,
        ]),
      ).toEqual([["BBBB2222222", 0]]);
    });

    it("the detail has both the files and the count", async () => {
      const { service } = setup();
      await service.addFile("ct-1", upload as any, undefined, ops);

      const detail = await service.findOne("ct-1", ops);

      expect(detail.files).toHaveLength(1);
      expect(detail.filesCount).toBe(1);
    });

    it("adds a file to a container with its name, uploader and trimmed description", async () => {
      const { service, fileRepo, filesService } = setup();

      const saved = await service.addFile(
        "ct-1",
        upload as any,
        "  packing list  ",
        ops,
      );

      expect(filesService.save).toHaveBeenCalledWith(upload, ops.id);
      expect(saved).toMatchObject({
        actualContainer: { id: "ct-1" },
        fileUrl: "/files/stored-1/download",
        fileName: "packing list.pdf",
        uploadedBy: { id: ops.id },
        description: "packing list",
      });
      expect(fileRepo.rows).toHaveLength(1);
    });

    it("stores an empty description as null and refuses an unknown container before saving the bytes", async () => {
      const { service, filesService } = setup();

      const saved = await service.addFile("ct-1", upload as any, "   ", ops);
      expect(saved.description).toBeNull();

      await expect(
        service.addFile("missing", upload as any, undefined, ops),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(filesService.save).toHaveBeenCalledTimes(1);
    });

    it("removes a file row, and 404s one that does not exist", async () => {
      const { service, fileRepo } = setup();
      await service.addFile("ct-1", upload as any, undefined, ops);
      const id = fileRepo.rows[0].id!;

      await service.removeFile(id, ops);

      expect(fileRepo.rows).toHaveLength(0);
      await expect(service.removeFile(id, ops)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("lets ops and the owning client download, and 404s another customer's client", async () => {
      const { service, filesService } = setup();
      await service.addFile("ct-1", upload as any, undefined, ops);
      const id = (await service.findOne("ct-1", ops)).files[0].id;

      await expect(service.downloadFile(id, ops)).resolves.toBeDefined();
      await expect(service.downloadFile(id, client)).resolves.toBeDefined();
      expect(filesService.openStoredFile).toHaveBeenCalledWith("stored-1");
      await expect(
        service.downloadFile(id, otherClient),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.downloadFile(id, orphanClient),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.downloadFile("missing", ops)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("validates the description field", async () => {
      const ok = await validate(
        plainToInstance(AddContainerFileDto, { description: "x" }),
      );
      const tooLong = await validate(
        plainToInstance(AddContainerFileDto, { description: "x".repeat(501) }),
      );

      expect(ok).toHaveLength(0);
      expect(tooLong.length).toBeGreaterThan(0);
    });
  });

  describe("action journal (Phase 20b)", () => {
    const file = {
      originalname: "BL.pdf",
      mimetype: "application/pdf",
      size: 3,
      buffer: Buffer.from("pdf"),
    };

    it("date edit and reset are journaled with the before/after values", async () => {
      const { service, audit } = setup();

      await service.updateDates("ct-1", { overrideEta: "2026-06-01" }, ops);
      await service.resetDates("ct-1", ops);

      expect(audit.entries).toEqual([
        expect.objectContaining({
          actor: ops,
          action: "container.dates_changed",
          entityType: "actual_container",
          entityId: "ct-1",
          metadata: {
            containerNumber: "AAAA1111111",
            from: { overrideEtd: null, overrideEta: null },
            to: { overrideEtd: null, overrideEta: "2026-06-01" },
          },
        }),
        expect.objectContaining({
          action: "container.dates_reset",
          metadata: {
            containerNumber: "AAAA1111111",
            from: { overrideEtd: null, overrideEta: "2026-06-01" },
          },
        }),
      ]);
    });

    it("arrival confirmation (client) and its revocation (ops) are journaled", async () => {
      const { service, audit } = setup();

      await service.confirmArrival("ct-1", client);
      await service.revokeArrivalConfirmation("ct-1", ops);

      expect(audit.entries.map((e) => [e.action, e.actor.id])).toEqual([
        ["container.arrival_confirmed", client.id],
        ["container.arrival_revoked", ops.id],
      ]);
      expect(audit.entries[1].metadata).toMatchObject({
        containerNumber: "AAAA1111111",
        confirmedAt: expect.any(Date),
      });
    });

    it("file upload and delete are journaled with the file's name", async () => {
      const { service, fileRepo, audit } = setup();

      await service.addFile("ct-1", file as any, "bill of lading", ops);
      await service.removeFile(fileRepo.rows[0].id!, ops);

      expect(audit.entries).toEqual([
        expect.objectContaining({
          action: "container.file_uploaded",
          entityId: "ct-1",
          metadata: expect.objectContaining({
            containerNumber: "AAAA1111111",
            fileName: "BL.pdf",
            description: "bill of lading",
          }),
        }),
        expect.objectContaining({
          action: "container.file_deleted",
          entityId: "ct-1",
          metadata: expect.objectContaining({
            containerNumber: "AAAA1111111",
            fileName: "BL.pdf",
          }),
        }),
      ]);
    });

    it("a refused action journals nothing", async () => {
      const { service, audit } = setup();

      await service.confirmArrival("ct-1", ops).catch(() => undefined);
      await service
        .revokeArrivalConfirmation("ct-1", ops)
        .catch(() => undefined);
      await service
        .updateDates("ct-2", { overrideEta: null }, client)
        .catch(() => undefined);

      expect(audit.entries).toEqual([]);
    });
  });
});
