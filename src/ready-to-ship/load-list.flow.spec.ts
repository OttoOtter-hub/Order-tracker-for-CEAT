import { HttpException } from "@nestjs/common";
import { LoadListStatus } from "./load-list.entity";
import { computeLoadListDiff } from "./load-list.service";
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
    () => ({ status: 0, code: "no error" }) as Record<string, unknown>,
    (e: unknown) => {
      const body = (e as HttpException).getResponse() as Record<
        string,
        unknown
      >;
      return {
        status: (e as HttpException).getStatus(),
        code: body.code,
        ...(body.params ? { params: body.params } : {}),
        ...(body.details ? { details: body.details } : {}),
      } as Record<string, unknown>;
    },
  );

/**
 * Phase 25 — CEAT builds the load list, the client accepts it or edits it.
 *
 * Line A: 150 units, 100 per container; line B: 100 units, 100 per
 * container -> 3 slots (+ OK to mix).
 */
describe("Load list flow (Phase 25)", () => {
  let h: Harness;
  let clock: ReturnType<typeof useControlledClock>;

  beforeEach(() => {
    clock = useControlledClock();
    h = makeHarness({ loadListStatus: LoadListStatus.DRAFT_CEAT });
    seedLine(h, {
      id: "li-A",
      piNumber: "100000001",
      materialNum: "AAA",
      dispatchQty: "150",
    });
    seedLine(h, {
      id: "li-B",
      piNumber: "100000002",
      materialNum: "BBB",
      dispatchQty: "100",
    });
  });

  afterEach(() => clock.restore());

  const label = (view: ReadyToShipView, l: string) =>
    view.containers.find((c) => c.label === l)!;
  const placement = (view: ReadyToShipView) =>
    view.containers
      .filter((c) => c.allocations.length > 0)
      .map((c) => [
        c.label,
        c.allocations
          .map((a) => `${a.materialNum}:${a.allocatedQty}`)
          .join(","),
      ]);
  const opsMove = async (container: string, line: string, qty: number) => {
    clock.tick();
    const view = await h.service.getView(opsActor, "cust-1");
    return h.service.move(
      { piLineItemId: line, containerId: label(view, container).id, qty },
      opsActor,
      "cust-1",
    );
  };
  const clientMove = async (container: string, line: string, qty: number) => {
    clock.tick();
    const view = await h.service.getView(clientActor);
    return h.service.move(
      { piLineItemId: line, containerId: label(view, container).id, qty },
      clientActor,
    );
  };
  const events = () => h.eventEmitter.emit.mock.calls.map(([event]) => event);

  /** CEAT's version: C1 = A 100, C2 = A 50 + B 50. */
  async function ceatDraftsAndSends() {
    await opsMove("Контейнер 1", "li-A", 100);
    await opsMove("Контейнер 2", "li-A", 50);
    await opsMove("Контейнер 2", "li-B", 50);
    return h.loadListService.send(opsActor, "cust-1");
  }

  it("CEAT -> client accepts: sent with a snapshot, then confirmed as it is", async () => {
    // While CEAT drafts, the client sees nothing of it.
    await opsMove("Контейнер 1", "li-A", 100);
    const hidden = await h.service.getView(clientActor);
    expect(hidden.containers.every((c) => c.allocations.length === 0)).toBe(
      true,
    );
    expect(hidden.loadList).toMatchObject({
      status: "draft_ceat",
      editor: "ops",
      canEdit: false,
    });
    await opsMove("Контейнер 2", "li-A", 50);
    await opsMove("Контейнер 2", "li-B", 50);

    const sent = await h.loadListService.send(opsActor, "cust-1");
    expect(sent.loadList).toMatchObject({
      status: "sent_to_client",
      editor: null,
      canEdit: false,
    });
    expect(h.actions.rows).toHaveLength(0); // CEAT's undo log is gone
    const ll = h.loadLists.rows.find((r) => r.customerId === "cust-1")!;
    expect(
      ll.ceatSnapshot.containers.map((c: any) => [
        c.label,
        c.positions.map((p: any) => p.qty),
      ]),
    ).toEqual([
      ["Контейнер 1", [100]],
      ["Контейнер 2", [50, 50]],
    ]);

    const forClient = await h.service.getView(clientActor);
    expect(placement(forClient)).toEqual([
      ["Контейнер 1", "AAA:100"],
      ["Контейнер 2", "AAA:50,BBB:50"],
    ]);

    const accepted = await h.loadListService.accept(clientActor);

    expect(accepted.loadList.status).toBe("confirmed");
    expect(h.allocations.rows.every((a) => a.isLocked)).toBe(true);
    expect(events()).toEqual(["load-list.sent", "load-list.accepted"]);
    expect(h.eventEmitter.emit.mock.calls[0][1]).toEqual({
      customerId: "cust-1",
      customerName: "MTK ROSBERG",
    });
    expect(
      h.audit.actions().filter((a) => a.startsWith("rts.load_list")),
    ).toEqual(["rts.load_list_sent", "rts.load_list_accepted"]);
    expect(
      h.audit.entries.find((e) => e.action === "rts.load_list_accepted")!
        .metadata,
    ).toMatchObject({
      from: "sent_to_client",
      to: "confirmed",
      positionsLocked: 3,
    });
  });

  it("edit request -> the client's changes -> submitted -> CEAT says OK: confirmed with the client's version", async () => {
    await ceatDraftsAndSends();

    const editing = await h.loadListService.requestEdit(clientActor);
    expect(editing.loadList).toMatchObject({
      status: "client_editing",
      editor: "client",
      canEdit: true,
    });
    // The client moves 50 of B from C2 to C3.
    const c2B = h.allocations.rows.find((a) => a.piLineItem.id === "li-B")!;
    clock.tick();
    await h.service.remove(
      { allocationId: c2B.id as string, qty: 50 },
      clientActor,
    );
    await clientMove("Контейнер 3", "li-B", 50);
    // The client can't undo CEAT's moves: only their own two.
    expect((await h.service.getView(clientActor)).undoableActions).toBe(2);

    await h.loadListService.submit(clientActor);
    expect(h.loadListStatus()).toBe(LoadListStatus.SUBMITTED_BY_CLIENT);

    const diff = await h.loadListService.diff(opsActor, "cust-1");
    expect(diff.lines).toEqual([
      expect.objectContaining({
        piNumber: "100000002",
        materialNum: "BBB",
        changes: [
          { container: "Контейнер 2", ceatQty: 50, clientQty: 0 },
          { container: "Контейнер 3", ceatQty: 0, clientQty: 50 },
        ],
      }),
    ]);
    expect(
      diff.containers.map((c) => [
        c.label,
        c.ceatFillPercent,
        c.clientFillPercent,
      ]),
    ).toEqual([
      ["Контейнер 1", 100, 100],
      ["Контейнер 2", 100, 50],
      ["Контейнер 3", 0, 50],
    ]);

    const approved = await h.loadListService.approve(opsActor, "cust-1");

    expect(approved.loadList.status).toBe("confirmed");
    expect(placement(approved)).toEqual([
      ["Контейнер 1", "AAA:100"],
      ["Контейнер 2", "AAA:50"],
      ["Контейнер 3", "BBB:50"],
    ]);
    expect(h.allocations.rows.every((a) => a.isLocked)).toBe(true);
    expect(events()).toEqual([
      "load-list.sent",
      "load-list.edit-requested",
      "load-list.submitted",
      "load-list.approved",
    ]);
  });

  it("changes -> CEAT rejects with a comment: back to CEAT's version, the comment for the client", async () => {
    await ceatDraftsAndSends();
    await h.loadListService.requestEdit(clientActor);
    const c1A = h.allocations.rows.find(
      (a) => a.piLineItem.id === "li-A" && a.allocatedQty === "100",
    )!;
    clock.tick();
    await h.service.remove(
      { allocationId: c1A.id as string, qty: 100 },
      clientActor,
    );
    await h.loadListService.submit(clientActor);

    expect(
      await failure(h.loadListService.reject(opsActor, "   ", "cust-1")),
    ).toMatchObject({ status: 400, code: "REJECTION_COMMENT_REQUIRED" });

    const rejected = await h.loadListService.reject(
      opsActor,
      "Контейнер 1 нужен полностью",
      "cust-1",
    );

    expect(rejected.loadList).toMatchObject({
      status: "sent_to_client",
      rejectionComment: "Контейнер 1 нужен полностью",
      rejectionAdjustments: [],
    });
    expect(placement(await h.service.getView(clientActor))).toEqual([
      ["Контейнер 1", "AAA:100"],
      ["Контейнер 2", "AAA:50,BBB:50"],
    ]);
    expect(h.eventEmitter.emit.mock.calls.at(-1)).toEqual([
      "load-list.rejected",
      {
        customerId: "cust-1",
        customerName: "MTK ROSBERG",
        comment: "Контейнер 1 нужен полностью",
        adjustments: [],
      },
    ]);
    // The client may ask to edit again.
    await expect(
      h.loadListService.requestEdit(clientActor),
    ).resolves.toBeDefined();
  });

  it("a rollback cut by the current stock is journaled and shown with the comment", async () => {
    await ceatDraftsAndSends();
    await h.loadListService.requestEdit(clientActor);
    await h.loadListService.submit(clientActor);
    // A backorder upload meanwhile: only 120 of A left for this week.
    h.lines.rows.find((l) => l.id === "li-A")!.currentWeekDispatchQty = "120";

    const rejected = await h.loadListService.reject(
      opsActor,
      "Исправьте",
      "cust-1",
    );

    expect(rejected.loadList.rejectionAdjustments).toEqual([
      {
        containerLabel: "Контейнер 2",
        piNumber: "100000001",
        materialNum: "AAA",
        soNumber: "300029159",
        wanted: 50,
        placed: 20,
      },
    ]);
    expect(
      h.audit.entries.find((e) => e.action === "rts.load_list_rejected")!
        .metadata,
    ).toMatchObject({
      comment: "Исправьте",
      adjustments: ["AAA (PI 100000001), Контейнер 2: 50 → 20"],
    });
  });

  it("an unlocked position that comes back unchanged keeps its marking file — through a rejection and an Excel upload", async () => {
    await ceatDraftsAndSends();
    await h.loadListService.accept(clientActor);
    const c1 = label(await h.service.getView(clientActor), "Контейнер 1");
    const position = c1.allocations[0];
    await h.markingService.upload(
      position.id,
      { originalname: "m.pdf", buffer: Buffer.from("x"), size: 1 } as any,
      clientActor,
    );
    // CEAT reopens that one position and sends the load list again as it is.
    await h.service.unlockAllocation(position.id, opsActor);
    await h.loadListService.send(opsActor, "cust-1");
    await h.loadListService.requestEdit(clientActor);
    await clientMove("Контейнер 3", "li-B", 10);
    await h.loadListService.submit(clientActor);

    const rejected = await h.loadListService.reject(
      opsActor,
      "Без контейнера 3",
      "cust-1",
    );
    expect(placement(rejected)).toEqual([
      ["Контейнер 1", "AAA:100"],
      ["Контейнер 2", "AAA:50,BBB:50"],
    ]);
    expect(h.markings.rows.map((m) => m.allocation.id)).toEqual([position.id]);

    // The client's own export, uploaded back unchanged: still the same row.
    await h.loadListService.requestEdit(clientActor);
    const { buffer } = await h.service.exportXlsx(clientActor);
    await h.loadListService.importXlsx(
      clientActor,
      { buffer, originalname: "same.xlsx" },
      false,
    );
    expect(h.markings.rows.map((m) => m.allocation.id)).toEqual([position.id]);
    expect(
      label(await h.service.getView(clientActor), "Контейнер 1").allocations[0]
        .markingFile,
    ).not.toBeNull();
  });

  it("a rollback that leaves nothing to confirm can still be accepted", async () => {
    await ceatDraftsAndSends();
    await h.loadListService.requestEdit(clientActor);
    await h.loadListService.submit(clientActor);
    // Both lines left the backorder meanwhile: CEAT's version is cut to nothing.
    h.lines.rows.find((l) => l.id === "li-A")!.currentWeekDispatchQty = "0";
    h.lines.rows.find((l) => l.id === "li-B")!.currentWeekDispatchQty = "0";
    const rejected = await h.loadListService.reject(
      opsActor,
      "Остатков нет",
      "cust-1",
    );
    expect(rejected.containers.every((c) => c.allocations.length === 0)).toBe(
      true,
    );

    const accepted = await h.loadListService.accept(clientActor);

    expect(accepted.loadList.status).toBe("confirmed");
    expect(
      h.audit.entries.find((e) => e.action === "rts.load_list_accepted")!
        .metadata,
    ).toMatchObject({ containerLabels: [], positionsLocked: 0 });
  });

  it("OK is refused when the client's version no longer fits the current backorder — with the list", async () => {
    await ceatDraftsAndSends();
    await h.loadListService.requestEdit(clientActor);
    await h.loadListService.submit(clientActor);
    h.lines.rows.find((l) => l.id === "li-A")!.currentWeekDispatchQty = "120";
    h.lines.rows.find((l) => l.id === "li-B")!.loadability = "40";

    const result = await failure(h.loadListService.approve(opsActor, "cust-1"));

    expect(result).toMatchObject({ status: 400, code: "LOAD_LIST_OUTDATED" });
    expect(result.details).toEqual(
      expect.arrayContaining([
        {
          code: "OUTDATED_EXCEEDS_AVAILABLE",
          params: {
            piNumber: "100000001",
            materialNum: "AAA",
            wanted: 150,
            available: 120,
          },
        },
        {
          code: "OUTDATED_CONTAINER_OVERFILLED",
          params: { container: "2", percent: 175 },
        },
      ]),
    );
    expect(h.loadListStatus()).toBe(LoadListStatus.SUBMITTED_BY_CLIENT);
    expect(h.allocations.rows.some((a) => a.isLocked)).toBe(false);
  });

  describe("who may do what", () => {
    it("the client can't edit what CEAT sent, nor CEAT what the client edits — direct calls refused", async () => {
      await ceatDraftsAndSends();
      const anyAllocation = h.allocations.rows[0].id as string;

      expect(
        await failure(clientMove("Контейнер 3", "li-B", 10)),
      ).toMatchObject({
        status: 400,
        code: "LOAD_LIST_NOT_EDITABLE",
        params: { status: "sent_to_client" },
      });
      expect(await failure(opsMove("Контейнер 3", "li-B", 10))).toMatchObject({
        code: "LOAD_LIST_NOT_EDITABLE",
      });

      await h.loadListService.requestEdit(clientActor);
      expect(await failure(opsMove("Контейнер 3", "li-B", 10))).toMatchObject({
        code: "LOAD_LIST_NOT_EDITABLE",
        params: { status: "client_editing" },
      });
      for (const call of [
        () =>
          h.service.remove(
            { allocationId: anyAllocation, qty: 1 },
            opsActor,
            "cust-1",
          ),
        () => h.service.undoLast(opsActor, "cust-1"),
        () => h.service.undoAll(opsActor, "cust-1"),
        () =>
          h.service.clearContainer(
            h.containers.rows[0].id as string,
            opsActor,
            "cust-1",
          ),
        () => h.service.moveRemainingToMix(opsActor, "cust-1"),
      ]) {
        expect(await failure(call())).toMatchObject({
          code: "LOAD_LIST_NOT_EDITABLE",
        });
      }
    });

    it("each step only for its side, and only from its status", async () => {
      expect(await failure(h.loadListService.send(clientActor))).toMatchObject({
        status: 403,
        code: "OPS_ONLY_ACTION",
      });
      expect(
        await failure(h.loadListService.accept(opsActor, "cust-1")),
      ).toMatchObject({ status: 403, code: "CLIENT_ONLY_ACTION" });
      expect(
        await failure(h.loadListService.accept(clientActor)),
      ).toMatchObject({
        status: 400,
        code: "LOAD_LIST_WRONG_STATUS",
        params: { status: "draft_ceat" },
      });
      expect(
        await failure(h.loadListService.send(opsActor, "cust-1")),
      ).toMatchObject({ code: "LOAD_LIST_EMPTY" });
      await ceatDraftsAndSends();
      expect(
        await failure(h.loadListService.approve(opsActor, "cust-1")),
      ).toMatchObject({ code: "LOAD_LIST_WRONG_STATUS" });
      expect(
        await failure(h.loadListService.submit(clientActor)),
      ).toMatchObject({ code: "LOAD_LIST_WRONG_STATUS" });
      expect(
        await failure(
          h.loadListService.requestEdit(otherClientActor, "cust-1"),
        ),
      ).toMatchObject({ status: 404 });
    });

    it("CEAT can't send an overfilled load list", async () => {
      await opsMove("Контейнер 1", "li-A", 120);

      expect(
        await failure(h.loadListService.send(opsActor, "cust-1")),
      ).toMatchObject({ code: "CONTAINER_OVERFILLED" });
      expect(h.loadListStatus()).toBe(LoadListStatus.DRAFT_CEAT);
    });

    it("'Edit load list' takes a confirmed one back to CEAT; confirmed positions stay locked", async () => {
      await ceatDraftsAndSends();
      await h.loadListService.accept(clientActor);

      const reopened = await h.loadListService.reopen(opsActor, "cust-1");

      expect(reopened.loadList.status).toBe("draft_ceat");
      expect(h.allocations.rows.every((a) => a.isLocked)).toBe(true);
      // The client keeps seeing the confirmed part (and can do markings).
      expect(placement(await h.service.getView(clientActor))).toHaveLength(2);
    });
  });
});

describe("computeLoadListDiff", () => {
  const pos = (materialNum: string, qty: number, loadability = 100) => ({
    piNumber: "1",
    materialNum,
    soNumber: "S",
    piLineItemId: "x",
    piLabel: null,
    materialDesc: null,
    loadability,
    qty,
    locked: false,
  });
  const snap = (containers: [string, ReturnType<typeof pos>[]][]) => ({
    takenAt: "t",
    takenBy: "u",
    containers: containers.map(([label, positions]) => ({
      label,
      name: null,
      isOkToMix: label === "OK to mix",
      isManual: false,
      positions,
    })),
  });

  it("lists only what moved, per container, and both fills (none for OK to mix)", () => {
    const diff = computeLoadListDiff(
      snap([
        ["Контейнер 1", [pos("A", 80), pos("B", 20)]],
        ["OK to mix", [pos("C", 5)]],
      ]),
      snap([
        ["Контейнер 1", [pos("A", 80)]],
        ["Контейнер 2", [pos("B", 20)]],
        ["OK to mix", [pos("C", 5)]],
      ]),
    );

    expect(diff.lines.map((l) => [l.materialNum, l.changes])).toEqual([
      [
        "B",
        [
          { container: "Контейнер 1", ceatQty: 20, clientQty: 0 },
          { container: "Контейнер 2", ceatQty: 0, clientQty: 20 },
        ],
      ],
    ]);
    expect(
      diff.containers.map((c) => [
        c.label,
        c.ceatFillPercent,
        c.clientFillPercent,
      ]),
    ).toEqual([
      ["Контейнер 1", 100, 80],
      ["Контейнер 2", 0, 20],
      ["OK to mix", null, null],
    ]);
  });
});
