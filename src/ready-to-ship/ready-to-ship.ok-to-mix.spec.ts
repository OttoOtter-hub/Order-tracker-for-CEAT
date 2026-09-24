import { BadRequestException, HttpException } from "@nestjs/common";
import {
  clientActor,
  Harness,
  makeHarness,
  opsActor,
  seedLine,
  useControlledClock,
} from "./testing/ready-to-ship-harness";
import type { ReadyToShipView } from "./ready-to-ship.types";

const pdf = () =>
  ({ originalname: "marking.pdf", buffer: Buffer.from("x"), size: 1 }) as any;

const codeOf = async (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (e: unknown) =>
      ((e as HttpException).getResponse() as { code?: string }).code,
  );

/**
 * Phase 21 — the "OK to mix" container.
 *
 * Line A: 150 units, 100 per container (1.5 containers)
 * Line B: 100 units, 200 per container (0.5)        -> 2 numbered slots
 * Line N:  40 units, no loadability — not placeable anywhere but "OK to mix",
 *          and not counted toward the slots.
 */
describe("ReadyToShipService — OK to mix", () => {
  let h: Harness;
  let clock: ReturnType<typeof useControlledClock>;

  beforeEach(() => {
    clock = useControlledClock();
    h = makeHarness();
    seedLine(h, {
      id: "li-A",
      piNumber: "100000001",
      loadability: "100",
      dispatchQty: "150",
    });
    seedLine(h, {
      id: "li-B",
      piNumber: "100000002",
      loadability: "200",
      dispatchQty: "100",
    });
    seedLine(h, {
      id: "li-N",
      piNumber: "100000003",
      loadability: null,
      dispatchQty: "40",
    });
  });

  afterEach(() => clock.restore());

  const okToMixOf = (view: ReadyToShipView) =>
    view.containers.find((c) => c.isOkToMix)!;
  const numbered = (view: ReadyToShipView) =>
    view.containers.filter((c) => !c.isOkToMix);
  const move = (line: string, containerId: string, qty: number) => {
    clock.tick();
    return h.service.move(
      { piLineItemId: line, containerId, qty },
      clientActor,
    );
  };

  describe("the container itself", () => {
    it("is created lazily, once, last, with the fixed label — and is not a slot of the plan", async () => {
      const first = await h.service.getView(clientActor);

      expect(first.totalPossibleContainers).toBe(2); // li-N adds nothing
      expect(numbered(first).map((c) => c.label)).toEqual([
        "Контейнер 1",
        "Контейнер 2",
      ]);
      expect(first.containers.at(-1)).toMatchObject({
        label: "OK to mix",
        isOkToMix: true,
        fillPercent: 0,
        isOverfilled: false,
        totalQty: 0,
        totalLines: 0,
      });

      await h.service.getView(clientActor);
      expect(h.containers.rows.filter((r) => r.isOkToMix)).toHaveLength(1);
      expect(h.containers.rows).toHaveLength(3);
    });

    it("is created even when the plan needs no slots at all", async () => {
      h.lines.rows.splice(0, 2); // only the no-loadability line is left
      const view = await h.service.getView(clientActor);

      expect(view.totalPossibleContainers).toBe(0);
      expect(view.containers.map((c) => c.label)).toEqual(["OK to mix"]);
    });
  });

  describe("move", () => {
    it("places a line without loadability only in OK to mix", async () => {
      const view = await h.service.getView(clientActor);

      expect(await codeOf(move("li-N", numbered(view)[0].id, 10))).toBe(
        "LINE_NO_LOADABILITY",
      );
      const moved = await move("li-N", okToMixOf(view).id, 10);

      expect(okToMixOf(moved)).toMatchObject({ totalQty: 10, totalLines: 1 });
      expect(
        moved.unallocatedLines.find((l) => l.piLineItemId === "li-N"),
      ).toMatchObject({
        remainingQty: 30,
      });
    });

    it("also takes lines that do have loadability — without any fill", async () => {
      const view = await h.service.getView(clientActor);
      const moved = await move("li-A", okToMixOf(view).id, 150);

      expect(okToMixOf(moved)).toMatchObject({
        totalQty: 150,
        totalLines: 1,
        fillPercent: 0,
        isOverfilled: false,
      });
      expect(okToMixOf(moved).allocations[0].fillContribution).toBe(0);
    });
  });

  describe("confirm", () => {
    it("is never blocked by OK to mix, however much it holds", async () => {
      const view = await h.service.getView(clientActor);
      const okId = okToMixOf(view).id;
      // 150 + 100 units with loadability — 2.0 containers' worth in one place.
      await move("li-A", okId, 150);
      await move("li-B", okId, 100);
      const full = await move("li-N", okId, 40);

      expect(okToMixOf(full)).toMatchObject({
        totalQty: 290,
        totalLines: 3,
        isOverfilled: false,
      });
      expect(full.canConfirm).toBe(true);

      const confirmed = await h.service.confirm(clientActor);
      expect(okToMixOf(confirmed).isConfirmed).toBe(true);
    });

    it("still blocks on an overfilled numbered container next to it", async () => {
      const view = await h.service.getView(clientActor);
      await move("li-N", okToMixOf(view).id, 40);
      await move("li-A", numbered(view)[0].id, 150); // 150%

      await expect(h.service.confirm(clientActor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe("move-remaining-to-mix", () => {
    it("moves every line's whole remainder, no-loadability ones included, in one go", async () => {
      const view = await h.service.getView(clientActor);
      await move("li-A", numbered(view)[0].id, 100); // A has 50 left
      const actionsBefore = h.actions.rows.length;

      const after = await h.service.moveRemainingToMix(clientActor);

      expect(after.unallocatedLines).toEqual([]);
      expect(okToMixOf(after)).toMatchObject({
        totalQty: 50 + 100 + 40,
        totalLines: 3,
      });
      // One undo-log entry per line moved.
      expect(h.actions.rows.length - actionsBefore).toBe(3);
      expect(h.dataSource.transaction).toHaveBeenCalled();
      expect(h.audit.entries.at(-1)).toMatchObject({
        action: "rts.moved_remaining_to_mix",
        inTransaction: true,
        metadata: { containerLabel: "OK to mix", lines: 3, qty: 190 },
      });
    });

    it("adds to a line's existing OK to mix position instead of creating a second one", async () => {
      const view = await h.service.getView(clientActor);
      await move("li-N", okToMixOf(view).id, 15);

      const after = await h.service.moveRemainingToMix(clientActor);

      const n = okToMixOf(after).allocations.find(
        (a) => a.piLineItemId === "li-N",
      );
      expect(n?.allocatedQty).toBe(40);
      expect(okToMixOf(after).totalLines).toBe(3);
    });

    it("rolls back through undo-last (one line at a time) and undo-all (everything)", async () => {
      await h.service.getView(clientActor);
      await h.service.moveRemainingToMix(clientActor);

      clock.tick();
      const oneBack = await h.service.undoLast(clientActor);
      expect(oneBack.unallocatedLines).toHaveLength(1);
      expect(okToMixOf(oneBack).totalLines).toBe(2);

      const allBack = await h.service.undoAll(clientActor);
      expect(
        allBack.unallocatedLines
          .map((l) => l.remainingQty)
          .sort((a, b) => a - b),
      ).toEqual([40, 100, 150]);
      expect(okToMixOf(allBack).totalLines).toBe(0);
      expect(h.allocations.rows).toHaveLength(0);
      expect(h.actions.rows).toHaveLength(0);
    });

    it("400s NOTHING_TO_MOVE when everything is already placed", async () => {
      await h.service.getView(clientActor);
      await h.service.moveRemainingToMix(clientActor);

      expect(await codeOf(h.service.moveRemainingToMix(clientActor))).toBe(
        "NOTHING_TO_MOVE",
      );
    });

    it("refuses a confirmed OK to mix — all or nothing, nothing written", async () => {
      const view = await h.service.getView(clientActor);
      await move("li-N", okToMixOf(view).id, 10);
      await h.service.confirm(clientActor);
      const allocationsBefore = JSON.stringify(h.allocations.rows);
      const actionsBefore = h.actions.rows.length;

      // li-N's own position there is locked -> the whole call is refused.
      expect(await codeOf(h.service.moveRemainingToMix(clientActor))).toBe(
        "ALLOCATION_LOCKED",
      );
      expect(JSON.stringify(h.allocations.rows)).toBe(allocationsBefore);
      expect(h.actions.rows.length).toBe(actionsBefore);
    });

    it("is client-only", async () => {
      await h.service.getView(clientActor);
      expect(await codeOf(h.service.moveRemainingToMix(opsActor))).toBe(
        "CLIENT_ONLY_ACTION",
      );
    });
  });

  describe("shared machinery", () => {
    it("undo-all never recycles OK to mix: same container, same id", async () => {
      const view = await h.service.getView(clientActor);
      const okId = okToMixOf(view).id;
      await move("li-N", okId, 40);

      const after = await h.service.undoAll(clientActor);

      expect(okToMixOf(after).id).toBe(okId);
      expect(h.containers.rows.filter((r) => r.isOkToMix)).toHaveLength(1);
    });

    it("marking files work on its positions like on any other", async () => {
      const view = await h.service.getView(clientActor);
      await move("li-N", okToMixOf(view).id, 40);
      await h.service.confirm(clientActor);
      const allocationId = h.allocations.rows[0].id as string;

      await h.markingService.upload(allocationId, pdf(), clientActor);
      const withFile = await h.service.getView(clientActor);
      expect(okToMixOf(withFile)).toMatchObject({
        markingFilesUploaded: 1,
        markingFilesTotal: 1,
      });

      await h.markingService.remove(allocationId, clientActor);
      expect(h.markings.rows).toHaveLength(0);
    });

    it("ops can unlock it, whole or one position", async () => {
      const view = await h.service.getView(clientActor);
      const okId = okToMixOf(view).id;
      await move("li-N", okId, 40);
      await move("li-A", okId, 10);
      await h.service.confirm(clientActor);

      await h.service.unlockAllocation(
        h.allocations.rows[0].id as string,
        opsActor,
      );
      const partial = await h.service.getView(clientActor);
      expect(okToMixOf(partial).isPartiallyUnlocked).toBe(true);

      await h.service.unlock(okId, opsActor);
      const open = await h.service.getView(clientActor);
      expect(okToMixOf(open).allocations.every((a) => !a.isLocked)).toBe(true);
    });
  });
});
