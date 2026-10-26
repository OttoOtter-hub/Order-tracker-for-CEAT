import { LoadListStatus } from "./load-list.entity";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  clientActor,
  Harness,
  makeHarness,
  opsActor,
  seedLine,
  useControlledClock,
} from "./testing/ready-to-ship-harness";

const pdf = () =>
  ({ originalname: "marking.pdf", buffer: Buffer.from("x"), size: 1 }) as any;

// The plan's numbered slots; the always-present, empty "OK to mix" (Phase 21)
// is not part of this story.
const slots = <T extends { isOkToMix: boolean }>(containers: T[]) =>
  containers.filter((c) => !c.isOkToMix);

/**
 * The whole client/ops story end to end, on shared fake repos:
 * move -> undo-last -> move -> undo-all -> several moves -> confirm (blocked
 * above 100%, then allowed) -> marking files -> ops unlock -> a move changes
 * a quantity -> that row's marking file is dropped automatically.
 *
 * Line A: 150 units, 100 per container (1.5 containers).
 * Line B: 100 units, 200 per container (0.5 containers) -> 2 slots in total.
 */
describe("ready-to-ship scenario", () => {
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
  });

  afterEach(() => clock.restore());

  const containerIdByLabel = (label: string) =>
    h.containers.rows.find((c) => c.label === label)!.id as string;

  async function move(line: string, label: string, qty: number) {
    clock.tick();
    return h.service.move(
      { piLineItemId: line, containerId: containerIdByLabel(label), qty },
      clientActor,
    );
  }

  const allocationOf = (label: string, line: string) =>
    h.allocations.rows.find(
      (a) =>
        a.container.id === containerIdByLabel(label) &&
        a.piLineItem.id === line,
    ) as { id: string; allocatedQty: string } | undefined;

  const remaining = (view: Awaited<ReturnType<typeof move>>, line: string) =>
    view.unallocatedLines.find((l) => l.piLineItemId === line)?.remainingQty ??
    0;

  /** C1 = A90 (90%), C2 = A50 + B100 (100%), both confirmed; A has 10 left over. */
  async function arrangeConfirmedPlan() {
    await h.service.getView(clientActor);
    await move("li-A", "Контейнер 1", 90);
    await move("li-A", "Контейнер 2", 50);
    await move("li-B", "Контейнер 2", 100);
    return h.confirm(clientActor);
  }

  it("runs the full flow", async () => {
    // Lazy init: two slots, everything still unallocated.
    const initial = await h.service.getView(clientActor);
    expect(initial.totalPossibleContainers).toBe(2);
    // Two numbered slots plus the always-present "OK to mix" (Phase 21).
    expect(initial.containers.map((c) => c.label)).toEqual([
      "Контейнер 1",
      "Контейнер 2",
      "OK to mix",
    ]);
    expect(initial.unallocatedLines.map((l) => l.remainingQty).sort()).toEqual([
      100, 150,
    ]);

    // move -> undo-last
    const afterMove = await move("li-A", "Контейнер 1", 60);
    expect(remaining(afterMove, "li-A")).toBe(90);
    expect(afterMove.containers[0].fillPercent).toBe(60);
    const afterUndo = await h.service.undoLast(clientActor);
    expect(remaining(afterUndo, "li-A")).toBe(150);
    expect(h.allocations.rows).toHaveLength(0);
    expect(h.actions.rows).toHaveLength(0);

    // move -> undo-all
    await move("li-A", "Контейнер 1", 60);
    await move("li-B", "Контейнер 2", 50);
    const afterUndoAll = await h.service.undoAll(clientActor);
    expect(h.allocations.rows).toHaveLength(0);
    expect(h.actions.rows).toHaveLength(0);
    expect(afterUndoAll.containers.map((c) => c.label)).toEqual([
      "Контейнер 1",
      "Контейнер 2",
      "OK to mix",
    ]);
    expect(
      afterUndoAll.unallocatedLines.map((l) => l.remainingQty).sort(),
    ).toEqual([100, 150]);

    // Several moves that put C1 at 140%: confirm is blocked and changes nothing.
    await move("li-A", "Контейнер 1", 90);
    await move("li-A", "Контейнер 2", 50);
    const overfull = await move("li-B", "Контейнер 1", 100);
    expect(overfull.containers[0]).toMatchObject({
      fillPercent: 140,
      isOverfilled: true,
    });
    expect(overfull.canConfirm).toBe(false);
    await expect(h.confirm(clientActor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(h.containers.rows.every((c) => !c.isConfirmed)).toBe(true);

    // Fix it: undo the last move, put B into C2 instead -> C1 90%, C2 100%.
    await h.service.undoLast(clientActor);
    const fixed = await move("li-B", "Контейнер 2", 100);
    expect(slots(fixed.containers).map((c) => c.fillPercent)).toEqual([
      90, 100,
    ]);
    expect(fixed.canConfirm).toBe(true);

    // Confirm: one action, every container of the session.
    const confirmed = await h.confirm(clientActor);
    expect(slots(confirmed.containers).every((c) => c.isConfirmed)).toBe(true);
    await expect(move("li-A", "Контейнер 1", 10)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    // Marking files, one per allocation row.
    const a1 = allocationOf("Контейнер 1", "li-A")!;
    const a2A = allocationOf("Контейнер 2", "li-A")!;
    const a2B = allocationOf("Контейнер 2", "li-B")!;
    for (const allocation of [a1, a2A, a2B]) {
      await h.markingService.upload(allocation.id, pdf(), clientActor);
    }
    const withFiles = await h.service.getView(clientActor);
    expect(
      slots(withFiles.containers).map((c) => [
        c.markingFilesUploaded,
        c.markingFilesTotal,
      ]),
    ).toEqual([
      [1, 1],
      [2, 2],
    ]);

    // Ops unlocks C1 only: the load list goes back to CEAT (draft_ceat).
    // Its file is still there; the client sees only the confirmed C2 now.
    await h.service.unlock(containerIdByLabel("Контейнер 1"), opsActor);
    expect(h.loadListStatus()).toBe(LoadListStatus.DRAFT_CEAT);
    const forClient = await h.service.getView(clientActor);
    expect(
      slots(forClient.containers).map((c) => c.allocations.length),
    ).toEqual([0, 2]);
    const unlocked = await h.service.getView(opsActor, "cust-1");
    expect(slots(unlocked.containers).map((c) => c.isConfirmed)).toEqual([
      false,
      true,
    ]);
    expect(slots(unlocked.containers)[0].markingFilesUploaded).toBe(1);

    // CEAT changes the quantity: 10 units of A were never placed.
    clock.tick();
    const changed = await h.service.move(
      {
        piLineItemId: "li-A",
        containerId: containerIdByLabel("Контейнер 1"),
        qty: 10,
      },
      opsActor,
      "cust-1",
    );
    expect(allocationOf("Контейнер 1", "li-A")!.allocatedQty).toBe("100");
    expect(remaining(changed, "li-A")).toBe(0);

    // C1's changed row lost its file; the untouched, still-confirmed C2 rows kept theirs.
    expect(changed.containers[0].markingFilesUploaded).toBe(0);
    expect(changed.containers[1].markingFilesUploaded).toBe(2);
    expect(h.markings.rows.map((m) => m.allocation.id).sort()).toEqual(
      [a2A.id, a2B.id].sort(),
    );

    // CEAT undoes that move, sends the load list; the client accepts it.
    await h.service.undoLast(opsActor, "cust-1");
    expect(allocationOf("Контейнер 1", "li-A")!.allocatedQty).toBe("90");
    await h.loadListService.send(opsActor, "cust-1");
    const reconfirmed = await h.loadListService.accept(clientActor);
    expect(slots(reconfirmed.containers).map((c) => c.isConfirmed)).toEqual([
      true,
      true,
    ]);
    expect(h.loadListStatus()).toBe(LoadListStatus.CONFIRMED);
  });

  it("Phase 25: an unlock drops the client's undo log — nothing of their moves can be undone by CEAT", async () => {
    await arrangeConfirmedPlan();
    await h.service.unlock(containerIdByLabel("Контейнер 1"), opsActor);

    expect(h.actions.rows).toHaveLength(0);
    await expect(h.service.undoLast(opsActor, "cust-1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // CEAT empties the reopened container instead; files go with it, C2 stays.
    const view = await h.service.clearContainer(
      containerIdByLabel("Контейнер 1"),
      opsActor,
      "cust-1",
    );
    expect(
      slots(view.containers).map((c) => [
        c.label,
        c.isConfirmed,
        c.allocations.length,
      ]),
    ).toEqual([
      ["Контейнер 1", false, 0],
      ["Контейнер 2", true, 2],
    ]);
  });
});
