import { HttpException } from "@nestjs/common";
import {
  clientActor,
  Harness,
  makeHarness,
  opsActor,
  seedLine,
  useControlledClock,
} from "./testing/ready-to-ship-harness";
import type { ReadyToShipView } from "./ready-to-ship.types";

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 0, code: "no error", params: undefined }),
    (e: unknown) => {
      const body = (e as HttpException).getResponse() as {
        code?: string;
        params?: Record<string, unknown>;
      };
      return {
        status: (e as HttpException).getStatus(),
        code: body.code,
        params: body.params,
      };
    },
  );

/**
 * Positions of a proforma that a backorder upload archived: they stay in
 * their containers (marked), and "undo last" doesn't put a removed one back.
 *
 * Line A (active card) and line B (card that gets archived): 100 units
 * each, 100 per container.
 */
describe("ReadyToShipService — positions of an archived proforma", () => {
  let h: Harness;
  let clock: ReturnType<typeof useControlledClock>;

  beforeEach(() => {
    clock = useControlledClock();
    h = makeHarness();
    seedLine(h, { id: "li-A", piNumber: "100000001", materialNum: "AAA" });
    seedLine(h, { id: "li-B", piNumber: "100000002", materialNum: "BBB" });
  });

  afterEach(() => clock.restore());

  const archiveB = () => {
    const line = h.lines.rows.find((l) => l.id === "li-B")!;
    line.pi = { ...line.pi, isArchivedShipped: true };
  };
  const first = (view: ReadyToShipView) =>
    view.containers.find((c) => c.label === "Контейнер 1")!;
  const step = async <T>(work: () => Promise<T>) => {
    clock.tick();
    return work();
  };
  const move = (view: ReadyToShipView, piLineItemId: string, qty: number) =>
    step(() =>
      h.service.move(
        { piLineItemId, containerId: first(view).id, qty },
        clientActor,
      ),
    );
  const remove = (view: ReadyToShipView, piLineItemId: string, qty: number) =>
    step(() =>
      h.service.remove(
        {
          allocationId: first(view).allocations.find(
            (a) => a.piLineItemId === piLineItemId,
          )!.id,
          qty,
        },
        clientActor,
      ),
    );
  const placed = (view: ReadyToShipView, piLineItemId: string) =>
    view.containers
      .flatMap((c) => c.allocations)
      .filter((a) => a.piLineItemId === piLineItemId)
      .reduce((sum, a) => sum + a.allocatedQty, 0);

  it("marks a position whose proforma is archived; the rest are unmarked", async () => {
    let view = await h.service.getView(clientActor);
    view = await move(view, "li-A", 30);
    await move(view, "li-B", 20);
    archiveB();

    const after = await h.service.getView(clientActor);
    const opsView = await h.service.getView(opsActor, "cust-1");

    for (const v of [after, opsView]) {
      expect(
        first(v).allocations.map((a) => [a.materialNum, a.piArchived]),
      ).toEqual([
        ["AAA", false],
        ["BBB", true],
      ]);
    }
    // Still there, still counted: the client removes it.
    expect(first(after).totalQty).toBe(50);
  });

  it("'undo last' passes over a removal of an archived line, undoes the next one, and says what it skipped", async () => {
    let view = await h.service.getView(clientActor);
    view = await move(view, "li-A", 10); // oldest
    view = await move(view, "li-B", 20);
    await remove(view, "li-B", 20); // newest: B taken out again
    archiveB();
    h.audit.entries.length = 0;

    // 1st press: the B removal is skipped; the B move before it is undone
    // (taking out is fine — and there's nothing of B left to take out).
    const one = await step(() => h.service.undoLast(clientActor));
    expect(one.undoSkipped).toEqual([
      {
        code: "UNDO_SKIPPED_ARCHIVED_PI",
        piNumber: "100000002",
        materialNum: "BBB",
        container: "1",
        qty: 20,
      },
    ]);
    expect(placed(one, "li-B")).toBe(0);
    expect(placed(one, "li-A")).toBe(10);

    // 2nd press: skipped again (it's still in the log), A's move is undone.
    const two = await step(() => h.service.undoLast(clientActor));
    expect(two.undoSkipped?.map((s) => s.materialNum)).toEqual(["BBB"]);
    expect(placed(two, "li-A")).toBe(0);
    expect(placed(two, "li-B")).toBe(0);

    // 3rd press: only the skipped one is left — 400 with the same reason,
    // nothing restored.
    expect(await failure(step(() => h.service.undoLast(clientActor)))).toEqual({
      status: 400,
      code: "UNDO_SKIPPED_ARCHIVED_PI",
      params: {
        materialNum: "BBB",
        piNumber: "100000002",
        container: "1",
        qty: 20,
      },
    });
    expect(h.allocations.rows).toHaveLength(0);

    // The skipped entry was never counted as undone: it is still in the
    // log, and the journal has an undo for the other two only.
    expect(h.actions.rows.map((a) => Number(a.deltaQty))).toEqual([-20]);
    expect(
      h.audit.entries
        .filter((e) => e.action === "rts.undone_last")
        .map((e) => [e.metadata?.materialNum, e.metadata?.undoneDelta]),
    ).toEqual([
      ["BBB", 20],
      ["AAA", 10],
    ]);
    // "Undo all" still clears it, without restoring anything.
    const cleared = await step(() => h.service.undoAll(clientActor));
    expect(cleared.undoableActions).toBe(0);
    expect(placed(cleared, "li-B")).toBe(0);
  });

  it("an active line's removal is undone as before, without a skip report", async () => {
    let view = await h.service.getView(clientActor);
    view = await move(view, "li-A", 10);
    await remove(view, "li-A", 4);
    archiveB();

    const undone = await step(() => h.service.undoLast(clientActor));

    expect(undone.undoSkipped).toBeUndefined();
    expect(placed(undone, "li-A")).toBe(10);
  });

  it("undoing a move of an archived line takes it out of the container as before", async () => {
    const view = await h.service.getView(clientActor);
    await move(view, "li-B", 20);
    archiveB();

    const undone = await step(() => h.service.undoLast(clientActor));

    expect(undone.undoSkipped).toBeUndefined();
    expect(placed(undone, "li-B")).toBe(0);
  });

  it("with nothing at all to undo it is still 404 NOTHING_TO_UNDO", async () => {
    await h.service.getView(clientActor);

    expect(await failure(h.service.undoLast(clientActor))).toMatchObject({
      status: 404,
      code: "NOTHING_TO_UNDO",
    });
  });
});
