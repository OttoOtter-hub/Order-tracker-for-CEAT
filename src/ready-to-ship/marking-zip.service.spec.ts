import { HttpException } from "@nestjs/common";
import {
  clientActor,
  Harness,
  makeHarness,
  opsActor,
  otherClientActor,
  seedLine,
} from "./testing/ready-to-ship-harness";

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 0, code: "no error" }),
    (e: unknown) => ({
      status: (e as HttpException).getStatus(),
      code: ((e as HttpException).getResponse() as { code?: string }).code,
    }),
  );

/**
 * Phase 24 — what goes into a container's marking ZIP
 * (MarkingFilesService.prepareContainerArchive; the streaming itself is
 * utils/marking-zip).
 */
describe("MarkingFilesService.prepareContainerArchive", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    seedLine(h, { id: "li-A", materialNum: "107071" });
    seedLine(h, { id: "li-B", materialNum: "113646" });
    seedLine(h, { id: "li-C", materialNum: "107071", soNumber: "300099999" });
    h.containers.seed({
      id: "c-1",
      customer: { id: "cust-1" },
      label: "Контейнер 1",
      name: "Ростов",
    } as any);
    h.containers.seed({
      id: "c-2",
      customer: { id: "cust-1" },
      label: "Контейнер 2",
      name: null,
    } as any);
    for (const [id, container, line] of [
      ["al-A", "c-1", "li-A"],
      ["al-B", "c-1", "li-B"],
      ["al-C", "c-1", "li-C"],
      ["al-2", "c-2", "li-A"],
    ]) {
      h.allocations.seed({
        id,
        container: { id: container },
        piLineItem: { id: line },
        allocatedQty: "10",
        isLocked: true,
      } as any);
    }
  });

  function marking(
    id: string,
    allocationId: string,
    fileId: string,
    at: string,
  ) {
    h.markings.seed({
      id,
      allocation: { id: allocationId },
      fileUrl: `/files/${fileId}/download`,
      uploadedAt: new Date(at),
    } as any);
  }

  /** Container 1: three files; two of them are both "marking.pdf" for material 107071. */
  function seedContainer1() {
    h.storedFiles.set("f-A", { originalName: "marking.pdf" });
    h.storedFiles.set("f-B", { originalName: "Маркировка поставки.pdf" });
    h.storedFiles.set("f-C", { originalName: "marking.pdf" });
    marking("m-A", "al-A", "f-A", "2026-10-01T10:00:00Z");
    marking("m-B", "al-B", "f-B", "2026-10-01T10:01:00Z");
    marking("m-C", "al-C", "f-C", "2026-10-01T10:02:00Z");
  }

  it("every marking file of the container, named '<material>_<original name>', repeats numbered; archive named after the container", async () => {
    seedContainer1();

    const archive = await h.markingService.prepareContainerArchive(
      "c-1",
      clientActor,
    );

    expect(archive).toEqual({
      fileName: "Контейнер 1 Ростов_marking.zip",
      entries: [
        { name: "107071_marking.pdf", path: "/uploads/f-A" },
        { name: "113646_Маркировка поставки.pdf", path: "/uploads/f-B" },
        { name: "107071_marking_2.pdf", path: "/uploads/f-C" },
      ],
      skipped: 0,
    });
  });

  it("ops gets any customer's container; a client only their own (another's is 404)", async () => {
    seedContainer1();

    const forOps = await h.markingService.prepareContainerArchive(
      "c-1",
      opsActor,
    );
    expect(forOps.entries).toHaveLength(3);
    expect(
      await failure(
        h.markingService.prepareContainerArchive("c-1", otherClientActor),
      ),
    ).toEqual({ status: 404, code: "NOT_FOUND" });
    expect(
      await failure(
        h.markingService.prepareContainerArchive("no-such", clientActor),
      ),
    ).toEqual({ status: 404, code: "NOT_FOUND" });
  });

  it("a container without marking files: 404 NO_MARKING_FILES", async () => {
    seedContainer1();

    expect(
      await failure(
        h.markingService.prepareContainerArchive("c-2", clientActor),
      ),
    ).toEqual({ status: 404, code: "NO_MARKING_FILES" });
  });

  it("only the files there are now: after some were deleted, the rest", async () => {
    seedContainer1();
    // Unlocked and one file taken off — as clear/remove/replace do.
    h.markings.rows.splice(
      h.markings.rows.findIndex((m) => m.id === "m-A"),
      1,
    );

    const archive = await h.markingService.prepareContainerArchive(
      "c-1",
      clientActor,
    );

    expect(archive.entries.map((e) => e.name)).toEqual([
      "113646_Маркировка поставки.pdf",
      "107071_marking.pdf",
    ]);
  });

  it("a file missing on disk is left out (and logged), the rest still goes", async () => {
    seedContainer1();
    h.storedFiles.set("f-B", {
      originalName: "Маркировка поставки.pdf",
      onDisk: false,
    });

    const archive = await h.markingService.prepareContainerArchive(
      "c-1",
      clientActor,
    );

    expect(archive.entries.map((e) => e.name)).toEqual([
      "107071_marking.pdf",
      "107071_marking_2.pdf",
    ]);
    expect(archive.skipped).toBe(1);
  });

  it("when every file is missing on disk it is NO_MARKING_FILES, not an empty archive", async () => {
    h.storedFiles.set("f-X", { originalName: "x.pdf", onDisk: false });
    marking("m-X", "al-2", "f-X", "2026-10-01T10:00:00Z");

    expect(
      await failure(
        h.markingService.prepareContainerArchive("c-2", clientActor),
      ),
    ).toEqual({ status: 404, code: "NO_MARKING_FILES" });
  });
});
