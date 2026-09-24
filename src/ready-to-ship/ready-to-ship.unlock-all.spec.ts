import { HttpException } from "@nestjs/common";
import { NotificationEvent } from "../notifications/notification-events";
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

const pdf = () =>
  ({ originalname: "marking.pdf", buffer: Buffer.from("x"), size: 1 }) as any;

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 0, code: "no error" }),
    (e: unknown) => ({
      status: (e as HttpException).getStatus(),
      code: ((e as HttpException).getResponse() as { code?: string }).code,
    }),
  );

/**
 * POST /ready-to-ship/unlock-all — ops reopens every container of a customer
 * that has a locked position, at once.
 *
 * cust-1: Line A 150 (100 per container), Line B 100 (200 per container),
 *         Line N 40 (no loadability, OK to mix only).
 *   Контейнер 1 <- A 100          (1 position)
 *   Контейнер 2 <- B 100          (1 position)
 *   OK to mix   <- A 50, N 40     (2 positions)
 * cust-2: its own line and container, confirmed too — must never be touched.
 */
describe("ReadyToShipService.unlockAll", () => {
  let h: Harness;
  let clock: ReturnType<typeof useControlledClock>;
  let view: ReadyToShipView;

  const byLabel = (v: ReadyToShipView, label: string) =>
    v.containers.find((c) => c.label === label)!;
  const move = (
    line: string,
    containerId: string,
    qty: number,
    actor = clientActor,
  ) => {
    clock.tick();
    return h.service.move({ piLineItemId: line, containerId, qty }, actor);
  };
  const lockedCount = (customerId: string) =>
    h.allocations.rows.filter(
      (a: any) => a.isLocked && a.container.customer.id === customerId,
    ).length;

  beforeEach(async () => {
    clock = useControlledClock();
    h = makeHarness();
    seedLine(h, { id: "li-A", loadability: "100", dispatchQty: "150" });
    seedLine(h, { id: "li-B", loadability: "200", dispatchQty: "100" });
    seedLine(h, { id: "li-N", loadability: null, dispatchQty: "40" });
    seedLine(h, {
      id: "li-X",
      customerId: "cust-2",
      loadability: "100",
      dispatchQty: "50",
    });

    view = await h.service.getView(clientActor);
    await move("li-A", byLabel(view, "Контейнер 1").id, 100);
    await move("li-B", byLabel(view, "Контейнер 2").id, 100);
    await move("li-A", byLabel(view, "OK to mix").id, 50);
    await move("li-N", byLabel(view, "OK to mix").id, 40);
    view = await h.service.confirm(clientActor);

    const other = await h.service.getView(otherClientActor);
    await move("li-X", other.containers[0].id, 50, otherClientActor);
    await h.service.confirm(otherClientActor);

    h.audit.entries.length = 0;
    h.eventEmitter.emit.mockClear();
  });

  afterEach(() => clock.restore());

  it("unlocks every position of every confirmed container of the customer — OK to mix just like the numbered ones", async () => {
    expect(lockedCount("cust-1")).toBe(4);

    const result = await h.service.unlockAll(opsActor, "cust-1");

    expect(result).toEqual({
      customerId: "cust-1",
      containersUnlocked: 3,
      positionsUnlocked: 4,
      containers: [
        {
          id: byLabel(view, "Контейнер 1").id,
          label: "Контейнер 1",
          positionsUnlocked: 1,
        },
        {
          id: byLabel(view, "Контейнер 2").id,
          label: "Контейнер 2",
          positionsUnlocked: 1,
        },
        {
          id: byLabel(view, "OK to mix").id,
          label: "OK to mix",
          positionsUnlocked: 2,
        },
      ],
    });
    expect(lockedCount("cust-1")).toBe(0);

    const after = await h.service.getView(clientActor);
    for (const label of ["Контейнер 1", "Контейнер 2", "OK to mix"]) {
      const container = byLabel(after, label);
      expect(container.isConfirmed).toBe(false);
      expect(container.isPartiallyUnlocked).toBe(false);
      expect(container.confirmedAt).toBeNull();
      expect(container.allocations.every((a) => !a.isLocked)).toBe(true);
    }

    // The client can edit again — including inside OK to mix.
    const okAllocation = byLabel(after, "OK to mix").allocations.find(
      (a) => a.piLineItemId === "li-N",
    )!;
    await expect(
      h.service.remove({ allocationId: okAllocation.id, qty: 10 }, clientActor),
    ).resolves.toBeDefined();
  });

  it("never touches another customer's containers", async () => {
    expect(lockedCount("cust-2")).toBe(1);

    await h.service.unlockAll(opsActor, "cust-1");

    expect(lockedCount("cust-2")).toBe(1);
    const other = await h.service.getView(otherClientActor);
    expect(other.containers.some((c) => c.isConfirmed)).toBe(true);
  });

  it("frees only what is still locked: a container ops already partly reopened counts its locked positions only", async () => {
    const ok = byLabel(view, "OK to mix");
    const nLine = ok.allocations.find((a) => a.piLineItemId === "li-N")!;
    await h.service.unlockAllocation(nLine.id, opsActor); // OK to mix: 1 of 2 left
    await h.service.unlock(byLabel(view, "Контейнер 2").id, opsActor); // fully open
    h.audit.entries.length = 0;

    const result = await h.service.unlockAll(opsActor, "cust-1");

    expect(
      result.containers.map((c) => [c.label, c.positionsUnlocked]),
    ).toEqual([
      ["Контейнер 1", 1],
      ["OK to mix", 1],
    ]);
    expect(result.positionsUnlocked).toBe(2);
  });

  it("journals one rts.unlocked_all, in the transaction, with the right counts and labels", async () => {
    await h.service.unlockAll(opsActor, "cust-1");

    expect(h.audit.entries).toEqual([
      expect.objectContaining({
        action: "rts.unlocked_all",
        entityType: "customer",
        entityId: "cust-1",
        actor: opsActor,
        inTransaction: true,
        metadata: {
          containersUnlocked: 3,
          positionsUnlocked: 4,
          containerLabels: ["Контейнер 1", "Контейнер 2", "OK to mix"],
        },
      }),
    ]);
  });

  it("sends the same 'reopened for the client' notice unlock() does, once per reopened container", async () => {
    await h.service.unlockAll(opsActor, "cust-1");

    const reopened = h.eventEmitter.emit.mock.calls
      .filter(
        ([event]) => event === NotificationEvent.CONTAINER_REOPENED_FOR_CLIENT,
      )
      .map(([, payload]) => payload);
    expect(reopened).toEqual([
      { label: "Контейнер 1", customerId: "cust-1" },
      { label: "Контейнер 2", customerId: "cust-1" },
      { label: "OK to mix", customerId: "cust-1" },
    ]);
  });

  it("nothing locked is not an error: zeros, an empty list, no journal entry, no notice", async () => {
    await h.service.unlockAll(opsActor, "cust-1");
    h.audit.entries.length = 0;
    h.eventEmitter.emit.mockClear();

    const again = await h.service.unlockAll(opsActor, "cust-1");

    expect(again).toEqual({
      customerId: "cust-1",
      containersUnlocked: 0,
      positionsUnlocked: 0,
      containers: [],
    });
    expect(h.audit.entries).toHaveLength(0);
    expect(h.eventEmitter.emit).not.toHaveBeenCalled();
  });

  it("is ops-only: a client gets 403 OPS_ONLY_ACTION and nothing is unlocked", async () => {
    expect(await failure(h.service.unlockAll(clientActor))).toEqual({
      status: 403,
      code: "OPS_ONLY_ACTION",
    });
    expect(await failure(h.service.unlockAll(clientActor, "cust-1"))).toEqual({
      status: 403,
      code: "OPS_ONLY_ACTION",
    });
    expect(lockedCount("cust-1")).toBe(4);
    expect(h.audit.entries).toHaveLength(0);
  });

  it("ops must name the customer (400 CUSTOMER_ID_REQUIRED)", async () => {
    expect(await failure(h.service.unlockAll(opsActor))).toEqual({
      status: 400,
      code: "CUSTOMER_ID_REQUIRED",
    });
    expect(lockedCount("cust-1")).toBe(4);
  });

  it("marking files stay after the unlock and go only when a position's quantity changes", async () => {
    const ok = byLabel(view, "OK to mix");
    const [kept, changed] = ok.allocations;
    await h.markingService.upload(kept.id, pdf(), clientActor);
    await h.markingService.upload(changed.id, pdf(), clientActor);

    await h.service.unlockAll(opsActor, "cust-1");
    const unlocked = byLabel(await h.service.getView(clientActor), "OK to mix");
    expect(unlocked.allocations.every((a) => a.markingFile !== null)).toBe(
      true,
    );

    clock.tick();
    await h.service.remove({ allocationId: changed.id, qty: 1 }, clientActor);
    const edited = byLabel(await h.service.getView(clientActor), "OK to mix");
    expect(
      edited.allocations.find((a) => a.id === kept.id)!.markingFile,
    ).not.toBeNull();
    expect(
      edited.allocations.find((a) => a.id === changed.id)!.markingFile,
    ).toBeNull();
  });
});
