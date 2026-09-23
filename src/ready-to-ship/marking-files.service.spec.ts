import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  clientActor,
  Harness,
  makeHarness,
  opsActor,
  otherClientActor,
  seedLine,
} from "./testing/ready-to-ship-harness";

const pdf = (name = "marking.pdf") =>
  ({ originalname: name, buffer: Buffer.from("x"), size: 1 }) as any;

describe("MarkingFilesService", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    seedLine(h, { id: "li-A", loadability: "100", dispatchQty: "100" });
    h.containers.seed({
      id: "c-confirmed",
      customer: { id: "cust-1" },
      label: "Контейнер 1",
    } as any);
    h.containers.seed({
      id: "c-draft",
      customer: { id: "cust-1" },
      label: "Контейнер 2",
    } as any);
    h.allocations.seed({
      id: "al-confirmed",
      container: { id: "c-confirmed" },
      piLineItem: { id: "li-A" },
      allocatedQty: "60",
      isLocked: true,
    } as any);
    h.allocations.seed({
      id: "al-draft",
      container: { id: "c-draft" },
      piLineItem: { id: "li-A" },
      allocatedQty: "40",
      isLocked: false,
    } as any);
  });

  describe("upload", () => {
    it("stores the file and records it against the allocation", async () => {
      const result = await h.markingService.upload(
        "al-confirmed",
        pdf(),
        clientActor,
      );

      expect(h.filesService.save).toHaveBeenCalledWith(
        expect.anything(),
        clientActor.id,
      );
      expect(h.markings.rows).toHaveLength(1);
      expect(h.markings.rows[0]).toMatchObject({
        allocation: { id: "al-confirmed" },
        fileUrl: "/files/stored-1/download",
        uploadedBy: { id: clientActor.id },
      });
      expect(result).toMatchObject({ allocationId: "al-confirmed" });
    });

    it("replaces an existing file: still exactly one per allocation, pointing at the new upload", async () => {
      await h.markingService.upload(
        "al-confirmed",
        pdf("first.pdf"),
        clientActor,
      );
      await h.markingService.upload(
        "al-confirmed",
        pdf("second.pdf"),
        clientActor,
      );

      expect(h.markings.rows).toHaveLength(1);
      expect(h.markings.rows[0].fileUrl).toBe("/files/stored-2/download");
    });

    it("keeps files of different allocations separate", async () => {
      h.allocations.seed({
        id: "al-second-line",
        container: { id: "c-confirmed" },
        piLineItem: { id: "li-A" },
        allocatedQty: "5",
        isLocked: true,
      } as any);

      await h.markingService.upload("al-confirmed", pdf(), clientActor);
      await h.markingService.upload("al-second-line", pdf(), clientActor);

      expect(h.markings.rows).toHaveLength(2);
    });

    it("refuses an allocation that isn't locked", async () => {
      await expect(
        h.markingService.upload("al-draft", pdf(), clientActor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(h.filesService.save).not.toHaveBeenCalled();
    });

    it("404s another customer's allocation (not 403) without storing anything", async () => {
      await expect(
        h.markingService.upload("al-confirmed", pdf(), otherClientActor),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(h.filesService.save).not.toHaveBeenCalled();
    });

    it("404s an unknown allocation", async () => {
      await expect(
        h.markingService.upload("nope", pdf(), clientActor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("is client-only", async () => {
      await expect(
        h.markingService.upload("al-confirmed", pdf(), opsActor),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("remove", () => {
    it("deletes the allocation's file", async () => {
      await h.markingService.upload("al-confirmed", pdf(), clientActor);

      await h.markingService.remove("al-confirmed", clientActor);

      expect(h.markings.rows).toHaveLength(0);
    });

    it("404s when there is no file, another customer's allocation, and is client-only", async () => {
      await expect(
        h.markingService.remove("al-confirmed", clientActor),
      ).rejects.toBeInstanceOf(NotFoundException);

      await h.markingService.upload("al-confirmed", pdf(), clientActor);
      await expect(
        h.markingService.remove("al-confirmed", otherClientActor),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        h.markingService.remove("al-confirmed", opsActor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.markings.rows).toHaveLength(1);
    });
  });

  describe("download", () => {
    beforeEach(async () => {
      await h.markingService.upload("al-confirmed", pdf(), clientActor);
    });

    it("streams the stored file for the owning client", async () => {
      const { file, stream } = await h.markingService.download(
        "al-confirmed",
        clientActor,
      );

      expect(h.filesService.openStoredFile).toHaveBeenCalledWith("stored-1");
      expect(file.mimeType).toBe("application/pdf");
      expect(stream).toBe("stream-of-stored-1");
    });

    it("lets ops download any customer's file", async () => {
      await expect(
        h.markingService.download("al-confirmed", opsActor),
      ).resolves.toBeDefined();
    });

    it("404s another client, and an allocation with no file", async () => {
      await expect(
        h.markingService.download("al-confirmed", otherClientActor),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        h.markingService.download("al-draft", clientActor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
