import {
  clientActor,
  Harness,
  makeHarness,
  opsActor,
  seedLine,
  useControlledClock,
} from "./testing/ready-to-ship-harness";

// Phase 20b: what "Ready to ship" writes to the action journal.
describe("ReadyToShipService / MarkingFilesService — action journal", () => {
  let h: Harness;
  let clock: ReturnType<typeof useControlledClock>;

  beforeEach(async () => {
    clock = useControlledClock();
    h = makeHarness();
    seedLine(h, {
      id: "li-A",
      piNumber: "100000001",
      materialNum: "107071",
      loadability: "100",
      dispatchQty: "150",
    });
    seedLine(h, {
      id: "li-B",
      piNumber: "100000002",
      loadability: "200",
      dispatchQty: "100",
    });
    await h.service.getView(clientActor); // creates the slots
  });

  afterEach(() => clock.restore());

  const containerId = (index: number) => h.containers.rows[index].id as string;
  const move = (line: string, index: number, qty: number) => {
    clock.tick();
    return h.service.move(
      { piLineItemId: line, containerId: containerId(index), qty },
      clientActor,
    );
  };

  it("move, remove, undo-last and undo-all are journaled inside their transactions", async () => {
    // undo-all recycles empty slots, so take the id before it runs.
    const firstContainerId = containerId(0);
    await move("li-A", 0, 30);
    clock.tick(); // the removal must be strictly newer, or "last" is a tie
    await h.service.remove(
      { allocationId: h.allocations.rows[0].id as string, qty: 10 },
      clientActor,
    );
    clock.tick();
    await h.service.undoLast(clientActor);
    await h.service.undoAll(clientActor);

    expect(h.audit.actions()).toEqual([
      "rts.moved",
      "rts.removed",
      "rts.undone_last",
      "rts.undone_all",
    ]);
    expect(h.audit.entries.every((e) => e.inTransaction)).toBe(true);
    expect(h.audit.entries[0]).toMatchObject({
      actor: clientActor,
      entityType: "shipping_container",
      entityId: firstContainerId,
      metadata: {
        containerLabel: "Контейнер 1",
        piNumber: "100000001",
        materialNum: "107071",
        qty: 30,
      },
    });
    expect(h.audit.entries[1].metadata).toMatchObject({
      piNumber: "100000001",
      qty: 10,
    });
    // undo-last rolled back the removal (a negative delta)
    expect(h.audit.entries[2].metadata).toMatchObject({ undoneDelta: -10 });
    expect(h.audit.entries[3]).toMatchObject({
      entityType: "customer",
      entityId: "cust-1",
    });
  });

  it("confirm, whole-container unlock and single-position unlock are journaled", async () => {
    await move("li-A", 0, 50);
    await move("li-B", 0, 20);
    await h.service.confirm(clientActor);
    await h.service.unlock(containerId(0), opsActor);
    await h.service.confirm(clientActor);
    const allocationId = h.allocations.rows[0].id as string;
    await h.service.unlockAllocation(allocationId, opsActor);

    expect(h.audit.actions()).toEqual([
      "rts.moved",
      "rts.moved",
      "rts.confirmed",
      "rts.container_unlocked",
      "rts.confirmed",
      "rts.position_unlocked",
    ]);
    expect(h.audit.entries[2]).toMatchObject({
      actor: clientActor,
      entityType: "customer",
      metadata: { containerLabels: ["Контейнер 1"], positionsLocked: 2 },
      inTransaction: true,
    });
    expect(h.audit.entries[3]).toMatchObject({
      actor: opsActor,
      entityId: containerId(0),
      metadata: { containerLabel: "Контейнер 1", positionsUnlocked: 2 },
    });
    expect(h.audit.entries[5]).toMatchObject({
      actor: opsActor,
      metadata: { allocationId, piNumber: "100000001", qty: 50 },
    });
  });

  it("marking file upload and delete are journaled with the position", async () => {
    await move("li-A", 0, 50);
    await h.service.confirm(clientActor);
    const allocationId = h.allocations.rows[0].id as string;
    const pdf = {
      originalname: "marking.pdf",
      mimetype: "application/pdf",
      size: 4,
      buffer: Buffer.from("%PDF"),
    } as Express.Multer.File;

    await h.markingService.upload(allocationId, pdf, clientActor);
    await h.markingService.remove(allocationId, clientActor);

    const marking = h.audit.entries.filter((e) =>
      e.action.startsWith("rts.marking"),
    );
    expect(marking.map((e) => [e.action, e.inTransaction])).toEqual([
      ["rts.marking_uploaded", true],
      ["rts.marking_deleted", false],
    ]);
    expect(marking[0].metadata).toMatchObject({
      containerLabel: "Контейнер 1",
      allocationId,
      piNumber: "100000001",
      replacedPrevious: false,
    });
  });

  it("a refused action journals nothing", async () => {
    await move("li-A", 0, 999).catch(() => undefined); // more than the remainder
    await h.service.undoLast(clientActor).catch(() => undefined); // nothing to undo
    await h.service.confirm(clientActor).catch(() => undefined); // nothing to confirm

    expect(h.audit.entries).toEqual([]);
  });
});
