import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import {
  clientActor,
  Harness,
  makeHarness,
  opsActor,
  otherClientActor,
  seedLine,
  useControlledClock,
} from "./testing/ready-to-ship-harness";

// The body an HttpException would send (before ApiExceptionFilter adds
// statusCode) — where a throw site's error code and params live.
async function rejectionBody(promise: Promise<unknown>): Promise<unknown> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) {
    throw new Error("expected the promise to reject with an HttpException");
  }
  return error.getResponse();
}

describe("ReadyToShipService", () => {
  let h: Harness;
  let clock: ReturnType<typeof useControlledClock>;

  beforeEach(() => {
    clock = useControlledClock();
    h = makeHarness();
    // Line A = 1.5 containers, line B = 0.5 -> exactly 2 slots.
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

  const containerId = (index: number) => h.containers.rows[index].id as string;
  // The plan's numbered slots — the always-present "OK to mix" (Phase 21)
  // is left out; its own specs are in ready-to-ship.ok-to-mix.spec.ts.
  const slots = <T extends object>(containers: T[]) =>
    containers.filter((c) => !(c as { isOkToMix?: boolean }).isOkToMix);

  async function move(
    piLineItemId: string,
    index: number,
    qty: number,
    actor = clientActor,
  ) {
    clock.tick();
    return h.service.move(
      { piLineItemId, containerId: containerId(index), qty },
      actor,
    );
  }

  describe("getView", () => {
    it("creates exactly totalPossibleContainers empty slots on the first visit, and none on the next", async () => {
      const first = await h.service.getView(clientActor);

      expect(first.totalPossibleContainers).toBe(2);
      expect(first.containers.map((c) => c.label)).toEqual([
        "Контейнер 1",
        "Контейнер 2",
        "OK to mix",
      ]);
      expect(
        first.containers.every(
          (c) => c.allocations.length === 0 && !c.isConfirmed,
        ),
      ).toBe(true);

      await h.service.getView(clientActor);
      expect(slots(h.containers.rows)).toHaveLength(2);
      expect(h.containers.rows).toHaveLength(3);
    });

    it("sizes the slot set from qty/loadability, not the stored (unreliable) load factor column", async () => {
      // seedLine gives every line currentWeekDispatchLoadFactor = 99.9999.
      const view = await h.service.getView(clientActor);

      expect(view.totalPossibleContainers).toBe(2);
    });

    it("counts only this client's active lines that have a dispatch qty", async () => {
      seedLine(h, {
        id: "li-archived",
        archived: true,
        loadability: "100",
        dispatchQty: "900",
      });
      seedLine(h, {
        id: "li-other",
        customerId: "cust-2",
        loadability: "100",
        dispatchQty: "900",
      });
      seedLine(h, { id: "li-zero", loadability: "100", dispatchQty: "0" });
      seedLine(h, { id: "li-null", loadability: "100", dispatchQty: null });

      const view = await h.service.getView(clientActor);

      expect(view.totalPossibleContainers).toBe(2);
      expect(view.unallocatedLines.map((l) => l.piLineItemId).sort()).toEqual([
        "li-A",
        "li-B",
      ]);
    });

    it("keeps already-allocated quantity in the slot total but out of the remaining list", async () => {
      await h.service.getView(clientActor);
      await move("li-B", 0, 100);
      const view = await move("li-A", 1, 60);

      expect(view.totalPossibleContainers).toBe(2);
      expect(view.unallocatedLines).toEqual([
        expect.objectContaining({
          piLineItemId: "li-A",
          allocatedQty: 60,
          remainingQty: 90,
        }),
      ]);
    });

    describe("slot top-up (the need grows between backorder uploads)", () => {
      // A new line of 1.0 container on top of the 2.0 from li-A / li-B.
      const growByOne = () =>
        seedLine(h, {
          id: "li-C",
          piNumber: "100000003",
          loadability: "100",
          dispatchQty: "100",
        });

      it("adds only the missing slots, keeping the existing containers and what is in them", async () => {
        const first = await h.service.getView(clientActor);
        await move("li-A", 0, 60);
        const idsBefore = slots(first.containers).map((c) => c.id);
        growByOne();

        const view = await h.service.getView(clientActor);

        expect(view.totalPossibleContainers).toBe(3);
        expect(slots(view.containers).map((c) => c.label)).toEqual([
          "Контейнер 1",
          "Контейнер 2",
          "Контейнер 3",
        ]);
        expect(view.containers.slice(0, 2).map((c) => c.id)).toEqual(idsBefore);
        expect(view.containers[0].allocations).toHaveLength(1);
        expect(view.containers[2].allocations).toHaveLength(0);
      });

      it("is idempotent: a second read after the top-up adds nothing", async () => {
        await h.service.getView(clientActor);
        growByOne();
        await h.service.getView(clientActor);

        await h.service.getView(clientActor);

        expect(slots(h.containers.rows)).toHaveLength(3);
      });

      it("counts confirmed containers toward the total, and tops up beyond them", async () => {
        await h.service.getView(clientActor);
        await move("li-A", 0, 100);
        await h.service.confirm(clientActor);

        const same = await h.service.getView(clientActor);
        expect(slots(same.containers)).toHaveLength(2);

        growByOne();
        const grown = await h.service.getView(clientActor);
        expect(
          slots(grown.containers).map((c) => [c.label, c.isConfirmed]),
        ).toEqual([
          ["Контейнер 1", true],
          ["Контейнер 2", false],
          ["Контейнер 3", false],
        ]);
      });

      it("never removes slots when the need shrinks", async () => {
        await h.service.getView(clientActor);
        h.lines.rows.find((r) => r.id === "li-B")!.pi.isArchivedShipped = true;

        const view = await h.service.getView(clientActor);

        expect(view.totalPossibleContainers).toBe(2); // 150 / 100 = 1.5 -> 2
        h.lines.rows.find((r) => r.id === "li-A")!.pi.isArchivedShipped = true;
        const shrunkFurther = await h.service.getView(clientActor);
        expect(shrunkFurther.totalPossibleContainers).toBe(0);
        expect(slots(shrunkFurther.containers)).toHaveLength(2);
      });

      it("recreates a slot that went missing, numbering after the highest label in use", async () => {
        await h.service.getView(clientActor);
        // The last numbered slot, not the "OK to mix" row created after it.
        h.containers.rows.splice(
          h.containers.rows.findIndex((r) => r.label === "Контейнер 2"),
          1,
        );

        const view = await h.service.getView(clientActor);

        expect(view.containers.map((c) => c.label)).toEqual([
          "Контейнер 1",
          "Контейнер 2",
          "OK to mix",
        ]);
      });

      it("tops up on the read that follows a write too, so every view returned by the API is complete", async () => {
        await h.service.getView(clientActor);
        growByOne();

        const view = await move("li-A", 0, 10);

        expect(slots(view.containers)).toHaveLength(3);
      });

      it("tolerates two reads racing to add the same new slot: the loser's unique violation is swallowed", async () => {
        await h.service.getView(clientActor);
        growByOne();
        h.containers.save.mockImplementationOnce(async () => {
          h.containers.seed({
            id: "won-3",
            customer: { id: "cust-1" },
            label: "Контейнер 3",
            isConfirmed: false,
          } as any);
          throw Object.assign(new Error("duplicate key"), { code: "23505" });
        });

        const view = await h.service.getView(clientActor);

        expect(slots(view.containers)).toHaveLength(3);
        expect(slots(view.containers)[2].id).toBe("won-3");
      });
    });

    it("reports fill percent, overfill and the marking-file counter per container", async () => {
      await h.service.getView(clientActor);
      await move("li-A", 0, 100); // 1.0
      const view = await move("li-B", 0, 100); // + 0.5 -> 1.5

      const [first, second] = view.containers;
      expect(first.fillPercent).toBe(150);
      expect(first.isOverfilled).toBe(true);
      expect(first.markingFilesTotal).toBe(2);
      expect(first.markingFilesUploaded).toBe(0);
      expect(second.fillPercent).toBe(0);
      expect(view.canConfirm).toBe(false);
    });

    it("tolerates two first visits racing: the loser's unique violation is swallowed and the winner's slots are used", async () => {
      h.containers.save.mockImplementationOnce(async () => {
        h.containers.seed({
          id: "won-1",
          customer: { id: "cust-1" },
          label: "Контейнер 1",
          isConfirmed: false,
        } as any);
        h.containers.seed({
          id: "won-2",
          customer: { id: "cust-1" },
          label: "Контейнер 2",
          isConfirmed: false,
        } as any);
        throw Object.assign(new Error("duplicate key"), { code: "23505" });
      });

      const view = await h.service.getView(clientActor);

      expect(view.containers.map((c) => c.id)).toEqual(["won-1", "won-2"]);
    });

    it("lets ops read any customer's view, but ops must name the customer", async () => {
      await expect(h.service.getView(opsActor)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      const view = await h.service.getView(opsActor, "cust-1");

      expect(view.customerId).toBe("cust-1");
      expect(view.unallocatedLines).toHaveLength(2);
    });

    it("404s a client who asks for another customer's view", async () => {
      await expect(
        h.service.getView(clientActor, "cust-2"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("gives another client their own (empty) view, never this client's containers", async () => {
      await h.service.getView(clientActor);

      const view = await h.service.getView(otherClientActor);

      expect(view.customerId).toBe("cust-2");
      // Their own, empty "OK to mix" only — nothing of cust-1's.
      expect(
        view.containers.map((c) => [c.label, c.allocations.length]),
      ).toEqual([["OK to mix", 0]]);
      expect(view.unallocatedLines).toEqual([]);
    });
  });

  describe("move", () => {
    beforeEach(async () => {
      await h.service.getView(clientActor);
    });

    it("creates an allocation and an undo-log entry", async () => {
      await move("li-A", 0, 60);

      expect(h.allocations.rows).toHaveLength(1);
      expect(h.allocations.rows[0]).toMatchObject({
        container: { id: containerId(0) },
        piLineItem: { id: "li-A" },
        allocatedQty: "60",
      });
      expect(h.actions.rows).toHaveLength(1);
      expect(h.actions.rows[0]).toMatchObject({
        deltaQty: "60",
        customer: { id: "cust-1" },
      });
    });

    it("adds to an existing allocation for the same container and line instead of making a second row", async () => {
      await move("li-A", 0, 60);
      await move("li-A", 0, 30);

      expect(h.allocations.rows).toHaveLength(1);
      expect(h.allocations.rows[0].allocatedQty).toBe("90");
      expect(h.actions.rows).toHaveLength(2);
    });

    it("can split one line across containers", async () => {
      await move("li-A", 0, 100);
      await move("li-A", 1, 50);

      expect(h.allocations.rows.map((a) => a.allocatedQty).sort()).toEqual([
        "100",
        "50",
      ]);
    });

    it("allows moving into a container beyond 100% (confirm is what blocks it)", async () => {
      await move("li-A", 0, 100);
      const view = await move("li-B", 0, 100);

      expect(view.containers[0].isOverfilled).toBe(true);
    });

    it("locks the line row so concurrent moves can't over-allocate it", async () => {
      await move("li-A", 0, 10);

      expect(h.lines.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ lock: { mode: "pessimistic_write" } }),
      );
    });

    it.each([
      ["a fractional qty", 1.5],
      ["zero", 0],
      ["a negative qty", -5],
      ["NaN", Number.NaN],
    ])("rejects %s with 400 and writes nothing", async (_label, qty) => {
      await expect(move("li-A", 0, qty)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(h.allocations.rows).toHaveLength(0);
      expect(h.actions.rows).toHaveLength(0);
    });

    it("rejects more than the line's unallocated remainder, counting allocations in every container", async () => {
      await move("li-A", 0, 100);

      await expect(move("li-A", 1, 51)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(await rejectionBody(move("li-A", 1, 51))).toEqual({
        code: "MOVE_EXCEEDS_REMAINING",
        message: expect.any(String),
        params: { qty: 51, remaining: 50 },
      });
      expect(h.allocations.rows).toHaveLength(1);

      await expect(move("li-A", 1, 50)).resolves.toBeDefined();
    });

    it("rejects a move into a confirmed container", async () => {
      await move("li-A", 0, 100);
      await h.service.confirm(clientActor);

      await expect(move("li-B", 0, 10)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("rejects a line with no usable loadability (its fill can't be computed)", async () => {
      seedLine(h, { id: "li-noload", loadability: null, dispatchQty: "10" });

      await expect(move("li-noload", 0, 5)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("rejects a line from an archived PI card", async () => {
      seedLine(h, { id: "li-archived", archived: true, dispatchQty: "10" });

      await expect(move("li-archived", 0, 5)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("404s another customer's line and another customer's container (not 403)", async () => {
      seedLine(h, { id: "li-other", customerId: "cust-2", dispatchQty: "10" });
      h.containers.seed({
        id: "c-other",
        customer: { id: "cust-2" },
        label: "Контейнер 1",
        isConfirmed: false,
      } as any);

      await expect(
        h.service.move(
          { piLineItemId: "li-other", containerId: containerId(0), qty: 1 },
          clientActor,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        h.service.move(
          { piLineItemId: "li-A", containerId: "c-other", qty: 1 },
          clientActor,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        h.service.move(
          { piLineItemId: "no-such-line", containerId: containerId(0), qty: 1 },
          clientActor,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      // Someone else's and non-existent read the same, code included.
      for (const dto of [
        { piLineItemId: "li-other", containerId: containerId(0), qty: 1 },
        { piLineItemId: "li-A", containerId: "c-other", qty: 1 },
      ]) {
        expect(
          await rejectionBody(h.service.move(dto, clientActor)),
        ).toMatchObject({ code: "NOT_FOUND" });
      }
      expect(h.allocations.rows).toHaveLength(0);
    });

    it("is client-only: ops is rejected with 403", async () => {
      await expect(move("li-A", 0, 10, opsActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(h.allocations.rows).toHaveLength(0);
    });
  });

  describe("undoLast", () => {
    beforeEach(async () => {
      await h.service.getView(clientActor);
    });

    it("rolls back only the newest move and removes its log entry", async () => {
      await move("li-A", 0, 60);
      await move("li-B", 1, 100);

      const view = await h.service.undoLast(clientActor);

      expect(h.actions.rows).toHaveLength(1);
      expect(h.allocations.rows).toHaveLength(1);
      expect(h.allocations.rows[0].piLineItem).toMatchObject({ id: "li-A" });
      expect(
        view.unallocatedLines.find((l) => l.piLineItemId === "li-B")
          ?.remainingQty,
      ).toBe(100);
    });

    it("decrements an allocation that has several moves, and deletes the row when it reaches zero", async () => {
      await move("li-A", 0, 60);
      await move("li-A", 0, 30);

      await h.service.undoLast(clientActor);
      expect(h.allocations.rows[0].allocatedQty).toBe("60");

      await h.service.undoLast(clientActor);
      expect(h.allocations.rows).toHaveLength(0);
    });

    it("404s when there is nothing to undo", async () => {
      await expect(h.service.undoLast(clientActor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("never undoes moves inside a confirmed container", async () => {
      await move("li-A", 0, 100);
      await h.service.confirm(clientActor);

      await expect(h.service.undoLast(clientActor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(h.allocations.rows).toHaveLength(1);
    });

    it("only sees this client's own actions", async () => {
      await move("li-A", 0, 60);

      await expect(h.service.undoLast(otherClientActor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(h.allocations.rows).toHaveLength(1);
    });

    it("is client-only", async () => {
      await expect(h.service.undoLast(opsActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe("undoableActions", () => {
    beforeEach(async () => {
      await h.service.getView(clientActor);
    });

    it("counts the actions undo can still roll back, including removals, so undo stays reachable when the containers look empty", async () => {
      expect((await h.service.getView(clientActor)).undoableActions).toBe(0);

      const afterMove = await move("li-A", 0, 60);
      expect(afterMove.undoableActions).toBe(1);

      clock.tick();
      const afterRemove = await h.service.remove(
        { allocationId: h.allocations.rows[0].id as string, qty: 60 },
        clientActor,
      );
      expect(afterRemove.containers[0].allocations).toHaveLength(0);
      expect(afterRemove.undoableActions).toBe(2);

      const afterUndo = await h.service.undoLast(clientActor);
      expect(afterUndo.undoableActions).toBe(1);
    });

    it("leaves out actions on confirmed containers and is back to 0 after undo-all", async () => {
      await move("li-A", 0, 100);
      await h.service.confirm(clientActor);
      await move("li-B", 1, 100);

      const view = await h.service.getView(clientActor);
      expect(view.undoableActions).toBe(1); // only C2's move, C1 is frozen

      expect((await h.service.undoAll(clientActor)).undoableActions).toBe(0);
    });
  });

  describe("remove", () => {
    beforeEach(async () => {
      await h.service.getView(clientActor);
    });

    const allocationId = () => h.allocations.rows[0].id as string;
    const removeQty = (qty: number, actor = clientActor, id?: string) => {
      clock.tick();
      return h.service.remove(
        { allocationId: id ?? allocationId(), qty },
        actor,
      );
    };

    it("takes part of an allocation back out, returns it to the list, and logs a negative action", async () => {
      await move("li-A", 0, 60);

      const view = await removeQty(20);

      expect(h.allocations.rows[0].allocatedQty).toBe("40");
      expect(h.actions.rows.map((a) => a.deltaQty)).toEqual(["60", "-20"]);
      expect(
        view.unallocatedLines.find((l) => l.piLineItemId === "li-A")
          ?.remainingQty,
      ).toBe(110);
    });

    it("deletes the allocation row when everything is removed", async () => {
      await move("li-A", 0, 60);

      const view = await removeQty(60);

      expect(h.allocations.rows).toHaveLength(0);
      expect(view.containers[0].allocations).toHaveLength(0);
      expect(
        view.unallocatedLines.find((l) => l.piLineItemId === "li-A")
          ?.remainingQty,
      ).toBe(150);
    });

    it("drops the marking file of the row whose quantity changed", async () => {
      await move("li-A", 0, 60);
      h.markings.seed({ id: "m-1", allocation: { id: allocationId() } } as any);

      await removeQty(10);

      expect(h.markings.rows).toHaveLength(0);
    });

    it("locks the allocation row so two quick removals can't take out more than is there", async () => {
      await move("li-A", 0, 60);

      await removeQty(10);

      expect(h.allocations.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ lock: { mode: "pessimistic_write" } }),
      );
    });

    it.each([
      ["a fractional qty", 1.5],
      ["zero", 0],
      ["a negative qty", -3],
      ["NaN", Number.NaN],
    ])("rejects %s with 400 and changes nothing", async (_label, qty) => {
      await move("li-A", 0, 60);

      await expect(removeQty(qty)).rejects.toBeInstanceOf(BadRequestException);
      expect(h.allocations.rows[0].allocatedQty).toBe("60");
      expect(h.actions.rows).toHaveLength(1);
    });

    it("rejects more than the allocation holds", async () => {
      await move("li-A", 0, 60);

      await expect(removeQty(61)).rejects.toBeInstanceOf(BadRequestException);
      expect(h.allocations.rows[0].allocatedQty).toBe("60");
    });

    it("refuses a confirmed container", async () => {
      await move("li-A", 0, 100);
      await h.service.confirm(clientActor);

      await expect(removeQty(10)).rejects.toBeInstanceOf(BadRequestException);
      expect(await rejectionBody(removeQty(10))).toMatchObject({
        code: "ALLOCATION_LOCKED",
      });
      expect(h.allocations.rows[0].allocatedQty).toBe("100");
    });

    it("404s another customer's allocation and an unknown one; ops gets 403", async () => {
      await move("li-A", 0, 60);

      await expect(removeQty(5, otherClientActor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(removeQty(5, clientActor, "nope")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(removeQty(5, opsActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(h.allocations.rows[0].allocatedQty).toBe("60");
    });

    it("can be undone: undo-last puts a partial removal back and drops its log entry", async () => {
      await move("li-A", 0, 60);
      await removeQty(20);

      await h.service.undoLast(clientActor);

      expect(h.allocations.rows[0].allocatedQty).toBe("60");
      expect(h.actions.rows.map((a) => a.deltaQty)).toEqual(["60"]);
    });

    it("can be undone: undo-last recreates an allocation that was removed completely", async () => {
      await move("li-A", 0, 60);
      await removeQty(60);
      expect(h.allocations.rows).toHaveLength(0);

      const view = await h.service.undoLast(clientActor);

      expect(h.allocations.rows).toHaveLength(1);
      expect(h.allocations.rows[0]).toMatchObject({
        container: { id: containerId(0) },
        piLineItem: { id: "li-A" },
        allocatedQty: "60",
      });
      expect(view.containers[0].allocations[0].allocatedQty).toBe(60);
    });

    it("refuses to undo a removal whose quantity has since been placed elsewhere and frozen by a confirm", async () => {
      await move("li-B", 0, 100); // C1 = B x100 (0.5)
      await removeQty(100); // C1 empty again
      await move("li-B", 1, 100); // the same units go to C2
      await h.service.confirm(clientActor); // C2 confirmed, no longer undoable

      let error: BadRequestException | undefined;
      await h.service.undoLast(clientActor).catch((e) => (error = e));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error!.message).toContain("уже размещены в другом контейнере");
      expect(h.allocations.rows).toHaveLength(1); // only C2's allocation
      expect(h.actions.rows.some((a) => a.deltaQty === "-100")).toBe(true); // log untouched
    });

    it("keeps undo-all consistent: moves and removals net out and everything rolls back", async () => {
      await move("li-A", 0, 60);
      await removeQty(20); // net 40 in the log, 40 in the allocation
      await move("li-B", 1, 100);
      await removeQty(100, clientActor, h.allocations.rows[1].id as string); // B fully out again

      const view = await h.service.undoAll(clientActor);

      expect(h.allocations.rows).toHaveLength(0);
      expect(h.actions.rows).toHaveLength(0);
      expect(view.unallocatedLines.map((l) => l.remainingQty).sort()).toEqual([
        100, 150,
      ]);
    });
  });

  describe("undoAll", () => {
    beforeEach(async () => {
      await h.service.getView(clientActor);
    });

    it("rolls every move back, drops the emptied containers and recreates the full slot set", async () => {
      const oldIds = h.containers.rows.map((c) => c.id);
      await move("li-A", 0, 100);
      await move("li-A", 1, 50);
      await move("li-B", 1, 100);

      const view = await h.service.undoAll(clientActor);

      expect(h.allocations.rows).toHaveLength(0);
      expect(h.actions.rows).toHaveLength(0);
      expect(view.containers.map((c) => c.label)).toEqual([
        "Контейнер 1",
        "Контейнер 2",
        "OK to mix",
      ]);
      // Emptied numbered slots are recycled; "OK to mix" never is.
      expect(slots(view.containers).some((c) => oldIds.includes(c.id))).toBe(
        false,
      );
      expect(oldIds).toContain(view.containers[2].id);
      expect(view.unallocatedLines.map((l) => l.remainingQty).sort()).toEqual([
        100, 150,
      ]);
    });

    it("leaves confirmed containers alone and recreates only the missing slots", async () => {
      await move("li-A", 0, 100); // C1 = 1.0
      await h.service.confirm(clientActor); // C1 confirmed; C2 stays an empty draft
      await move("li-A", 1, 50); // C2 = 0.5, draft

      const view = await h.service.undoAll(clientActor);

      // Total need is 2; one is confirmed, so exactly one draft slot comes
      // back — numbered after the highest label still in use.
      expect(
        slots(view.containers).map((c) => [c.label, c.isConfirmed]),
      ).toEqual([
        ["Контейнер 1", true],
        ["Контейнер 2", false],
      ]);
      expect(h.allocations.rows).toHaveLength(1);
      expect(h.allocations.rows[0].allocatedQty).toBe("100");
    });

    it("is a harmless no-op on an untouched plan", async () => {
      const view = await h.service.undoAll(clientActor);

      expect(slots(view.containers)).toHaveLength(2);
    });

    it("is client-only", async () => {
      await expect(h.service.undoAll(opsActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe("confirm", () => {
    beforeEach(async () => {
      await h.service.getView(clientActor);
    });

    it("confirms every non-empty draft together, stamping who and when, and leaves empty slots unconfirmed", async () => {
      await move("li-A", 0, 100);

      const view = await h.service.confirm(clientActor);

      const [first, second] = view.containers;
      expect(first.isConfirmed).toBe(true);
      expect(first.confirmedById).toBe(clientActor.id);
      expect(first.confirmedAt).toEqual(new Date(Date.now()));
      expect(second.isConfirmed).toBe(false);
    });

    it("refuses when any container is over 100%: 400 naming each one, nothing confirmed", async () => {
      await move("li-A", 0, 100);
      await move("li-B", 0, 100); // C1 = 150%
      await move("li-A", 1, 50); // C2 = 50%, fine on its own

      let error: BadRequestException | undefined;
      await h.service.confirm(clientActor).catch((e) => (error = e));

      expect(error).toBeInstanceOf(BadRequestException);
      const body = error!.getResponse() as any;
      expect(body.overfilledContainers).toEqual([
        expect.objectContaining({ label: "Контейнер 1", fillPercent: 150 }),
      ]);
      expect(body.message).toContain("Контейнер 1 (150%)");
      // The translatable param holds numbers only, not the Russian label.
      expect(body.code).toBe("CONTAINER_OVERFILLED");
      expect(body.params).toEqual({ containers: "#1 (150%)" });
      expect(h.allocations.rows.every((a) => !a.isLocked)).toBe(true);
    });

    it("counts exactly 100% as fine", async () => {
      await move("li-A", 0, 100);

      const view = await h.service.confirm(clientActor);

      expect(view.containers[0]).toMatchObject({
        isConfirmed: true,
        fillPercent: 100,
        isOverfilled: false,
      });
    });

    it("saves the whole set in one write so it is all-or-nothing", async () => {
      await move("li-A", 0, 100);
      await move("li-B", 1, 100);
      h.containers.save.mockClear();

      await h.service.confirm(clientActor);

      expect(h.containers.save).toHaveBeenCalledTimes(1);
      expect(h.containers.save.mock.calls[0][0]).toHaveLength(2);
    });

    it("400s when there is nothing to confirm", async () => {
      await expect(h.service.confirm(clientActor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("is client-only", async () => {
      await move("li-A", 0, 100);

      await expect(h.service.confirm(opsActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe("unlock", () => {
    beforeEach(async () => {
      await h.service.getView(clientActor);
      await move("li-A", 0, 100);
      await move("li-B", 1, 100);
      await h.service.confirm(clientActor);
    });

    it("unlocks only the named container and clears its confirmation stamp", async () => {
      const result = await h.service.unlock(containerId(0), opsActor);

      expect(result).toMatchObject({
        id: containerId(0),
        isConfirmed: false,
        customerId: "cust-1",
      });
      expect(h.containers.rows[0]).toMatchObject({
        confirmedAt: null,
        confirmedBy: null,
      });
      const allocationsOf = (index: number) =>
        h.allocations.rows.filter(
          (a: any) => a.container.id === containerId(index),
        );
      expect(allocationsOf(0).every((a: any) => !a.isLocked)).toBe(true);
      expect(allocationsOf(1).every((a: any) => a.isLocked)).toBe(true);
    });

    it("does not touch existing marking files by itself", async () => {
      h.markings.seed({
        id: "m-1",
        allocation: { id: h.allocations.rows[0].id },
      } as any);

      await h.service.unlock(containerId(0), opsActor);

      expect(h.markings.rows).toHaveLength(1);
    });

    it("is ops-only", async () => {
      await expect(
        h.service.unlock(containerId(0), clientActor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        h.allocations.rows
          .filter((a: any) => a.container.id === containerId(0))
          .every((a: any) => a.isLocked),
      ).toBe(true);
    });

    it("404s an unknown container and 400s one that isn't confirmed", async () => {
      await expect(h.service.unlock("nope", opsActor)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      await h.service.unlock(containerId(0), opsActor);
      await expect(
        h.service.unlock(containerId(0), opsActor),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("Phase 13: emits container.reopened-for-client with the container's label and customer id", async () => {
      await h.service.unlock(containerId(0), opsActor);

      expect(h.eventEmitter.emit).toHaveBeenCalledWith(
        "container.reopened-for-client",
        { label: "Контейнер 1", customerId: "cust-1" },
      );
    });

    it("Phase 13: does not emit when unlock fails (unconfirmed / unknown container)", async () => {
      await expect(h.service.unlock("nope", opsActor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(h.eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("unlockAllocation (Phase 16: one position, not the whole container)", () => {
    beforeEach(async () => {
      await h.service.getView(clientActor);
      await move("li-A", 0, 50); // 50%
      await move("li-B", 0, 50); // + 25% -> 75%, both land in Контейнер 1
      await h.service.confirm(clientActor);
    });

    const allocationOf = (line: string) =>
      h.allocations.rows.find((a: any) => a.piLineItem.id === line) as {
        id: string;
        isLocked: boolean;
      };

    it("unlocks only the named position, leaving its container's other positions locked", async () => {
      const result = await h.service.unlockAllocation(
        allocationOf("li-A").id,
        opsActor,
      );

      expect(result).toMatchObject({
        id: allocationOf("li-A").id,
        containerId: containerId(0),
        containerLabel: "Контейнер 1",
        customerId: "cust-1",
        isLocked: false,
      });
      expect(allocationOf("li-A").isLocked).toBe(false);
      expect(allocationOf("li-B").isLocked).toBe(true);
    });

    it("the container reads as partially unlocked in the view, not fully confirmed", async () => {
      await h.service.unlockAllocation(allocationOf("li-A").id, opsActor);

      const view = await h.service.getView(clientActor);

      expect(view.containers[0]).toMatchObject({
        isConfirmed: false,
        isPartiallyUnlocked: true,
      });
    });

    it("move works on the unlocked position and 400s on the still-locked one", async () => {
      await h.service.unlockAllocation(allocationOf("li-A").id, opsActor);

      await expect(move("li-A", 0, 5)).resolves.toBeDefined();
      expect(allocationOf("li-A").isLocked).toBe(false);

      await expect(move("li-B", 0, 5)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("remove works on the unlocked position and 400s on the still-locked one", async () => {
      await h.service.unlockAllocation(allocationOf("li-A").id, opsActor);

      await expect(
        h.service.remove(
          { allocationId: allocationOf("li-A").id, qty: 10 },
          clientActor,
        ),
      ).resolves.toBeDefined();

      await expect(
        h.service.remove(
          { allocationId: allocationOf("li-B").id, qty: 10 },
          clientActor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("confirm returns the unlocked position to locked, together with any other draft", async () => {
      await h.service.unlockAllocation(allocationOf("li-A").id, opsActor);
      await move("li-A", 0, 5);

      const view = await h.service.confirm(clientActor);

      expect(allocationOf("li-A").isLocked).toBe(true);
      expect(view.containers[0]).toMatchObject({
        isConfirmed: true,
        isPartiallyUnlocked: false,
      });
    });

    it("changing the unlocked position's qty drops only its own marking file", async () => {
      const pdf = () =>
        ({ originalname: "m.pdf", buffer: Buffer.from("x"), size: 1 }) as any;
      await h.markingService.upload(
        allocationOf("li-A").id,
        pdf(),
        clientActor,
      );
      await h.markingService.upload(
        allocationOf("li-B").id,
        pdf(),
        clientActor,
      );
      await h.service.unlockAllocation(allocationOf("li-A").id, opsActor);

      await move("li-A", 0, 5);

      expect(h.markings.rows.map((m: any) => m.allocation.id)).toEqual([
        allocationOf("li-B").id,
      ]);
    });

    it("404s an unknown allocation and 400s one that is already unlocked", async () => {
      await expect(
        h.service.unlockAllocation("nope", opsActor),
      ).rejects.toBeInstanceOf(NotFoundException);

      await h.service.unlockAllocation(allocationOf("li-A").id, opsActor);
      await expect(
        h.service.unlockAllocation(allocationOf("li-A").id, opsActor),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("is ops-only", async () => {
      await expect(
        h.service.unlockAllocation(allocationOf("li-A").id, clientActor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(allocationOf("li-A").isLocked).toBe(true);
    });

    it("emits container.reopened-for-client, same as the whole-container unlock", async () => {
      await h.service.unlockAllocation(allocationOf("li-A").id, opsActor);

      expect(h.eventEmitter.emit).toHaveBeenCalledWith(
        "container.reopened-for-client",
        { label: "Контейнер 1", customerId: "cust-1" },
      );
    });
  });
});
