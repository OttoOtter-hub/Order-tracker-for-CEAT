import { HttpException } from "@nestjs/common";
import {
  clientActor,
  Harness,
  makeHarness,
  opsActor,
  otherClientActor,
  seedLine,
  useControlledClock,
} from "./testing/ready-to-ship-harness";
import type { ReadyToShipView } from "./ready-to-ship.types";

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 0, code: "no error" }),
    (e: unknown) => ({
      status: (e as HttpException).getStatus(),
      code: ((e as HttpException).getResponse() as { code?: string }).code,
    }),
  );

/**
 * Phase 23 — "Clear container": every position of one container back to the
 * unallocated list at once, undone with one press.
 *
 * Lines A and B: 100 units each, 100 per container -> 2 slots (+ OK to mix).
 */
describe("ReadyToShipService.clearContainer", () => {
  let h: Harness;
  let clock: ReturnType<typeof useControlledClock>;

  beforeEach(() => {
    clock = useControlledClock();
    h = makeHarness();
    seedLine(h, { id: "li-A", piNumber: "100000001", materialNum: "AAA" });
    seedLine(h, { id: "li-B", piNumber: "100000002", materialNum: "BBB" });
  });

  afterEach(() => clock.restore());

  const byLabel = (view: ReadyToShipView, label: string) =>
    view.containers.find((c) => c.label === label)!;
  const remaining = (view: ReadyToShipView) =>
    Object.fromEntries(
      view.unallocatedLines.map((l) => [l.piLineItemId, l.remainingQty]),
    );
  const step = async <T>(work: () => Promise<T>) => {
    clock.tick();
    return work();
  };
  const move = (containerId: string, piLineItemId: string, qty: number) =>
    step(() => h.service.move({ piLineItemId, containerId, qty }, clientActor));

  /** Container 1 holds 30 of A and 20 of B; container 2 holds 10 of A. */
  async function fill() {
    const view = await h.service.getView(clientActor);
    const c1 = byLabel(view, "Контейнер 1").id;
    const c2 = byLabel(view, "Контейнер 2").id;
    await move(c1, "li-A", 30);
    await move(c1, "li-B", 20);
    await move(c2, "li-A", 10);
    return { c1, c2 };
  }

  it("returns every position of a draft to the list; the container stays, empty; the other container is untouched", async () => {
    const { c1 } = await fill();

    const view = await step(() => h.service.clearContainer(c1, clientActor));

    expect(byLabel(view, "Контейнер 1")).toMatchObject({
      id: c1,
      totalLines: 0,
      totalQty: 0,
      fillPercent: 0,
    });
    expect(byLabel(view, "Контейнер 2").totalQty).toBe(10);
    expect(remaining(view)).toEqual({ "li-A": 90, "li-B": 100 });
    expect(h.containers.rows.some((c) => c.id === c1)).toBe(true);
  });

  it("logs one negative undo entry per position, all in one group, and journals the clear once", async () => {
    const { c1 } = await fill();
    h.audit.entries.length = 0;

    await step(() => h.service.clearContainer(c1, clientActor));

    const cleared = h.actions.rows.filter((a) => Number(a.deltaQty) < 0);
    expect(
      cleared.map((a) => [a.piLineItem.id, Number(a.deltaQty)]).sort(),
    ).toEqual([
      ["li-A", -30],
      ["li-B", -20],
    ]);
    expect(new Set(cleared.map((a) => a.groupId)).size).toBe(1);
    expect(cleared[0].groupId).toEqual(expect.any(String));
    // Single moves have no group.
    expect(
      h.actions.rows
        .filter((a) => Number(a.deltaQty) > 0)
        .every((a) => !a.groupId),
    ).toBe(true);
    expect(h.audit.entries).toEqual([
      expect.objectContaining({
        actor: clientActor,
        action: "rts.container_cleared",
        entityType: "shipping_container",
        entityId: c1,
        metadata: { containerLabel: "Контейнер 1", lines: 2, qty: 50 },
        inTransaction: true,
      }),
    ]);
  });

  it("one 'undo last' puts the whole container back; the clear counts as one undoable step", async () => {
    const { c1 } = await fill();
    const before = await h.service.getView(clientActor);
    const cleared = await step(() => h.service.clearContainer(c1, clientActor));
    expect(cleared.undoableActions).toBe(before.undoableActions + 1);
    h.audit.entries.length = 0;

    const undone = await step(() => h.service.undoLast(clientActor));

    expect(byLabel(undone, "Контейнер 1")).toMatchObject({
      totalLines: 2,
      totalQty: 50,
    });
    expect(remaining(undone)).toEqual(remaining(before));
    expect(undone.undoableActions).toBe(before.undoableActions);
    expect(h.audit.entries).toEqual([
      expect.objectContaining({
        action: "rts.undone_last",
        entityId: c1,
        metadata: { containerLabel: "Контейнер 1", lines: 2, undoneDelta: -50 },
      }),
    ]);
    // The next press goes on with the moves before the clear, one at a time.
    const next = await step(() => h.service.undoLast(clientActor));
    expect(byLabel(next, "Контейнер 2").totalQty).toBe(0);
    expect(byLabel(next, "Контейнер 1").totalQty).toBe(50);
  });

  it("'undo all' after a clear rolls everything back as before", async () => {
    const { c1 } = await fill();
    await step(() => h.service.clearContainer(c1, clientActor));

    const view = await step(() => h.service.undoAll(clientActor));

    expect(view.containers.every((c) => c.totalQty === 0)).toBe(true);
    expect(remaining(view)).toEqual({ "li-A": 100, "li-B": 100 });
    expect(view.undoableActions).toBe(0);
  });

  describe("refusals", () => {
    it("a confirmed container: 400 CONTAINER_LOCKED, nothing removed", async () => {
      const { c1 } = await fill();
      await step(() => h.service.confirm(clientActor));

      expect(await failure(h.service.clearContainer(c1, clientActor))).toEqual({
        status: 400,
        code: "CONTAINER_LOCKED",
      });
      expect(h.allocations.rows).toHaveLength(3);
    });

    it("a partly unlocked container (one position reopened by ops): still refused", async () => {
      const { c1 } = await fill();
      await step(() => h.service.confirm(clientActor));
      const position = h.allocations.rows.find(
        (a) => a.container.id === c1 && a.piLineItem.id === "li-A",
      )!;
      await h.service.unlockAllocation(position.id as string, opsActor);

      expect(await failure(h.service.clearContainer(c1, clientActor))).toEqual({
        status: 400,
        code: "CONTAINER_LOCKED",
      });
    });

    it("an empty container: 400 CONTAINER_EMPTY", async () => {
      const { c1 } = await fill();
      const view = await h.service.getView(clientActor);
      const okToMix = view.containers.find((c) => c.isOkToMix)!;

      expect(
        await failure(h.service.clearContainer(okToMix.id, clientActor)),
      ).toEqual({ status: 400, code: "CONTAINER_EMPTY" });
      await step(() => h.service.clearContainer(c1, clientActor));
      expect(await failure(h.service.clearContainer(c1, clientActor))).toEqual({
        status: 400,
        code: "CONTAINER_EMPTY",
      });
    });

    it("another customer's container is a 404; ops gets a 403", async () => {
      const { c1 } = await fill();

      expect(
        await failure(h.service.clearContainer(c1, otherClientActor)),
      ).toEqual({ status: 404, code: "NOT_FOUND" });
      expect(await failure(h.service.clearContainer(c1, opsActor))).toEqual({
        status: 403,
        code: "CLIENT_ONLY_ACTION",
      });
      expect(
        await failure(
          h.service.clearContainer("no-such-container", clientActor),
        ),
      ).toEqual({ status: 404, code: "NOT_FOUND" });
      expect(h.allocations.rows).toHaveLength(3);
      expect(h.audit.actions()).not.toContain("rts.container_cleared");
    });
  });

  it("after ops unlocks a confirmed container, clearing it takes its marking files too", async () => {
    const { c1, c2 } = await fill();
    await step(() => h.service.confirm(clientActor));
    for (const a of h.allocations.rows) {
      h.markings.seed({ id: `m-${a.id}`, allocation: { id: a.id } } as any);
    }
    await h.service.unlock(c1, opsActor);

    await step(() => h.service.clearContainer(c1, clientActor));

    // Only container 2's marking file is left.
    const left = h.allocations.rows.filter((a) => a.container.id === c2);
    expect(h.markings.rows.map((m) => m.allocation.id)).toEqual(
      left.map((a) => a.id),
    );
  });

  it("'OK to mix' and a manual container are emptied but keep label, name and flags", async () => {
    const view = await h.service.getView(clientActor);
    const okToMix = view.containers.find((c) => c.isOkToMix)!;
    const added = await h.service.addContainer(clientActor);
    const manual = added.containers.find((c) => c.isManual)!;
    await h.service.rename(manual.id, "Доп", clientActor);
    await move(okToMix.id, "li-A", 5);
    await move(manual.id, "li-B", 7);

    await step(() => h.service.clearContainer(okToMix.id, clientActor));
    const after = await step(() =>
      h.service.clearContainer(manual.id, clientActor),
    );

    expect(after.containers.find((c) => c.id === okToMix.id)).toMatchObject({
      label: "OK to mix",
      isOkToMix: true,
      totalQty: 0,
    });
    expect(after.containers.find((c) => c.id === manual.id)).toMatchObject({
      isManual: true,
      name: "Доп",
      totalQty: 0,
    });
    expect(remaining(after)).toEqual({ "li-A": 100, "li-B": 100 });
  });
});
