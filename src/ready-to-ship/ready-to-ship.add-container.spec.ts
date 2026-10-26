import { LoadListStatus } from "./load-list.entity";
import { HttpException } from "@nestjs/common";
import {
  clientActor,
  Harness,
  makeHarness,
  opsActor,
  seedLine,
  useControlledClock,
} from "./testing/ready-to-ship-harness";
import { MAX_MANUAL_CONTAINERS } from "./ready-to-ship.service";
import type { ReadyToShipView } from "./ready-to-ship.types";

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 0, code: "no error" }),
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
 * A container added by the client by hand, on top of the plan's slots.
 *
 * Line A: 150 units, 100 per container -> 2 slots of the plan (+ OK to mix).
 */
describe("ReadyToShipService.addContainer (manual container)", () => {
  let h: Harness;
  let clock: ReturnType<typeof useControlledClock>;

  beforeEach(() => {
    clock = useControlledClock();
    h = makeHarness({ loadListStatus: LoadListStatus.DRAFT_CEAT });
    seedLine(h, {
      id: "li-A",
      piNumber: "100000001",
      loadability: "100",
      dispatchQty: "150",
    });
  });

  afterEach(() => clock.restore());

  const labels = (view: ReadyToShipView) => view.containers.map((c) => c.label);
  const manual = (view: ReadyToShipView) =>
    view.containers.filter((c) => c.isManual);
  const planned = (view: ReadyToShipView) =>
    view.containers.filter((c) => !c.isManual && !c.isOkToMix);
  const byLabel = (view: ReadyToShipView, label: string) =>
    view.containers.find((c) => c.label === label)!;
  const move = (containerId: string, qty: number, piLineItemId = "li-A") =>
    h.service.move({ piLineItemId, containerId, qty }, opsActor, "cust-1");

  describe("creating", () => {
    it("adds one container numbered after the plan's slots, flagged manual, before OK to mix", async () => {
      await h.service.getView(opsActor, "cust-1");

      const view = await h.service.addContainer(opsActor, "cust-1");

      expect(labels(view)).toEqual([
        "Контейнер 1",
        "Контейнер 2",
        "Контейнер 3",
        "OK to mix",
      ]);
      expect(manual(view).map((c) => c.label)).toEqual(["Контейнер 3"]);
      expect(byLabel(view, "Контейнер 3")).toMatchObject({
        isManual: true,
        isOkToMix: false,
        name: null,
        totalLines: 0,
        isConfirmed: false,
      });
      expect(planned(view).every((c) => !c.isManual)).toBe(true);
      // Stored, not only shown.
      expect(
        h.containers.rows.filter((c) => c.isManual).map((c) => c.label),
      ).toEqual(["Контейнер 3"]);
    });

    it("isn't counted in totalPossibleContainers — manual ones are reported apart", async () => {
      const before = await h.service.getView(opsActor, "cust-1");

      await h.service.addContainer(opsActor, "cust-1");
      const view = await h.service.addContainer(opsActor, "cust-1");

      expect(before.totalPossibleContainers).toBe(2);
      expect(before.manualContainers).toBe(0);
      expect(view.totalPossibleContainers).toBe(2);
      expect(view.manualContainers).toBe(2);
      expect(planned(view)).toHaveLength(2);
      // Ops sees the same picture.
      const opsView = await h.service.getView(opsActor, "cust-1");
      expect(opsView.manualContainers).toBe(2);
      expect(manual(opsView).map((c) => c.label)).toEqual([
        "Контейнер 3",
        "Контейнер 4",
      ]);
    });

    it("each next one takes the next number", async () => {
      await h.service.getView(opsActor, "cust-1");

      await h.service.addContainer(opsActor, "cust-1");
      await h.service.addContainer(opsActor, "cust-1");
      const view = await h.service.addContainer(opsActor, "cust-1");

      expect(manual(view).map((c) => c.label)).toEqual([
        "Контейнер 3",
        "Контейнер 4",
        "Контейнер 5",
      ]);
    });

    it("numbers after the highest number in use, whatever gaps the existing slots have", async () => {
      // What a few "undo all" rounds can leave behind: slots 1 and 7.
      for (const [id, label] of [
        ["c-1", "Контейнер 1"],
        ["c-7", "Контейнер 7"],
      ]) {
        h.containers.seed({
          id,
          label,
          customer: { id: "cust-1" },
          isOkToMix: false,
          isManual: false,
        } as any);
      }

      const view = await h.service.addContainer(opsActor, "cust-1");

      expect(labels(view)).toEqual([
        "Контейнер 1",
        "Контейнер 7",
        "Контейнер 8",
        "OK to mix",
      ]);
      expect(byLabel(view, "Контейнер 8").isManual).toBe(true);
    });

    it("on a page never opened before, the plan's slots are made first and the manual one comes after them", async () => {
      const view = await h.service.addContainer(opsActor, "cust-1");

      expect(planned(view).map((c) => c.label)).toEqual([
        "Контейнер 1",
        "Контейнер 2",
      ]);
      expect(manual(view).map((c) => c.label)).toEqual(["Контейнер 3"]);
    });

    it("a clash on the label (two clicks at once) is retried with the next number", async () => {
      await h.service.getView(opsActor, "cust-1");
      const realSave = h.containers.save.bind(h.containers);
      let clashes = 1;
      h.containers.save = (async (entity: any) => {
        if (clashes-- > 0) {
          // The other request won: its "Контейнер 3" is already there.
          await realSave({
            customer: { id: "cust-1" },
            label: "Контейнер 3",
            isOkToMix: false,
            isManual: true,
          });
          throw Object.assign(new Error("duplicate key"), { code: "23505" });
        }
        return realSave(entity);
      }) as any;

      const view = await h.service.addContainer(opsActor, "cust-1");

      expect(manual(view).map((c) => c.label)).toEqual([
        "Контейнер 3",
        "Контейнер 4",
      ]);
    });

    it("works like any other container: fill percent, name, confirm", async () => {
      const added = await h.service.addContainer(opsActor, "cust-1");
      const id = byLabel(added, "Контейнер 3").id;

      await move(id, 50);
      await h.service.rename(id, "Доп", opsActor, "cust-1");
      const confirmed = await h.confirm(opsActor);
      h.setLoadListStatus(LoadListStatus.DRAFT_CEAT);

      expect(byLabel(confirmed, "Контейнер 3")).toMatchObject({
        isManual: true,
        name: "Доп",
        totalQty: 50,
        fillPercent: 50,
        isConfirmed: true,
      });
    });
  });

  describe("refusals", () => {
    it(`allows ${MAX_MANUAL_CONTAINERS} manual containers and refuses the next with 400 MANUAL_CONTAINER_LIMIT`, async () => {
      for (let i = 0; i < MAX_MANUAL_CONTAINERS; i++) {
        await h.service.addContainer(opsActor, "cust-1");
      }

      expect(await failure(h.service.addContainer(opsActor, "cust-1"))).toEqual(
        {
          status: 400,
          code: "MANUAL_CONTAINER_LIMIT",
          params: { max: MAX_MANUAL_CONTAINERS },
        },
      );
      const view = await h.service.getView(opsActor, "cust-1");
      expect(view.manualContainers).toBe(MAX_MANUAL_CONTAINERS);
      expect(MAX_MANUAL_CONTAINERS).toBe(20);
    });

    it("the limit counts manual containers only, not the plan's slots", async () => {
      // 25 slots of the plan — more than the limit already.
      h.lines.rows[0].currentWeekDispatchQty = "2500";
      const before = await h.service.getView(opsActor, "cust-1");

      const view = await h.service.addContainer(opsActor, "cust-1");

      expect(planned(before)).toHaveLength(25);
      expect(manual(view).map((c) => c.label)).toEqual(["Контейнер 26"]);
    });

    it("400 NOTHING_TO_ALLOCATE when every line is fully placed", async () => {
      const view = await h.service.getView(opsActor, "cust-1");
      await move(byLabel(view, "Контейнер 1").id, 100);
      await move(byLabel(view, "Контейнер 2").id, 50);

      expect(
        await failure(h.service.addContainer(opsActor, "cust-1")),
      ).toMatchObject({
        status: 400,
        code: "NOTHING_TO_ALLOCATE",
      });
      expect(h.containers.rows.some((c) => c.isManual)).toBe(false);
    });

    it("400 NOTHING_TO_ALLOCATE when there are no lines to ship at all", async () => {
      h.lines.rows[0].currentWeekDispatchQty = "0";

      expect(
        await failure(h.service.addContainer(opsActor, "cust-1")),
      ).toMatchObject({
        status: 400,
        code: "NOTHING_TO_ALLOCATE",
      });
    });

    it("allowed again while even one unit is still unallocated", async () => {
      const view = await h.service.getView(opsActor, "cust-1");
      await move(byLabel(view, "Контейнер 1").id, 100);
      await move(byLabel(view, "Контейнер 2").id, 49);

      const after = await h.service.addContainer(opsActor, "cust-1");

      expect(manual(after)).toHaveLength(1);
    });
  });

  describe("who may add (Phase 25: CEAT, in draft_ceat)", () => {
    it("a client can't: 403 OPS_ONLY_ACTION, whatever the status", async () => {
      await h.service.getView(opsActor, "cust-1");
      h.setLoadListStatus(LoadListStatus.CLIENT_EDITING);

      expect(await failure(h.service.addContainer(clientActor))).toMatchObject({
        status: 403,
        code: "OPS_ONLY_ACTION",
      });
      expect(h.containers.rows.some((c) => c.isManual)).toBe(false);
    });

    it("ops only while CEAT drafts: 400 LOAD_LIST_NOT_EDITABLE otherwise; the customer must be named", async () => {
      await h.service.getView(opsActor, "cust-1");
      for (const status of [
        LoadListStatus.SENT_TO_CLIENT,
        LoadListStatus.CLIENT_EDITING,
        LoadListStatus.SUBMITTED_BY_CLIENT,
        LoadListStatus.CONFIRMED,
      ]) {
        h.setLoadListStatus(status);
        expect(
          await failure(h.service.addContainer(opsActor, "cust-1")),
        ).toMatchObject({ status: 400, code: "LOAD_LIST_NOT_EDITABLE" });
      }
      h.setLoadListStatus(LoadListStatus.DRAFT_CEAT);
      expect(await failure(h.service.addContainer(opsActor))).toMatchObject({
        status: 400,
        code: "CUSTOMER_ID_REQUIRED",
      });
      expect(h.containers.rows.some((c) => c.isManual)).toBe(false);
    });

    it("the container goes to the customer ops names, nobody else", async () => {
      seedLine(h, {
        id: "li-other",
        piNumber: "100000099",
        customerId: "cust-2",
        loadability: "100",
        dispatchQty: "100",
      });
      await h.service.getView(opsActor, "cust-1");
      h.setLoadListStatus(LoadListStatus.DRAFT_CEAT, "cust-2");

      const theirs = await h.service.addContainer(opsActor, "cust-2");

      expect(theirs.customerId).toBe("cust-2");
      expect(manual(theirs).map((c) => c.label)).toEqual(["Контейнер 2"]);
      const mine = await h.service.getView(opsActor, "cust-1");
      expect(mine.manualContainers).toBe(0);
      expect(labels(mine)).toEqual(["Контейнер 1", "Контейнер 2", "OK to mix"]);
    });
  });

  describe("the plan's slots next to manual ones", () => {
    it("a growing plan still gets every slot it is owed — a manual container doesn't stand in for one", async () => {
      await h.service.getView(opsActor, "cust-1");
      await h.service.addContainer(opsActor, "cust-1"); // Контейнер 3, manual

      // Next backorder: 350 units -> 4 slots of the plan.
      h.lines.rows[0].currentWeekDispatchQty = "350";
      const view = await h.service.getView(opsActor, "cust-1");

      expect(view.totalPossibleContainers).toBe(4);
      expect(planned(view).map((c) => c.label)).toEqual([
        "Контейнер 1",
        "Контейнер 2",
        "Контейнер 4",
        "Контейнер 5",
      ]);
      expect(manual(view).map((c) => c.label)).toEqual(["Контейнер 3"]);
      // And a second read adds nothing more.
      expect(labels(await h.service.getView(opsActor, "cust-1"))).toEqual(
        labels(view),
      );
    });

    it("a plan that already has its slots isn't topped up because of manual ones", async () => {
      await h.service.getView(opsActor, "cust-1");
      await h.service.addContainer(opsActor, "cust-1");
      await h.service.addContainer(opsActor, "cust-1");

      const view = await h.service.getView(opsActor, "cust-1");

      expect(planned(view)).toHaveLength(2);
      expect(h.containers.rows).toHaveLength(5); // 2 + 2 manual + OK to mix
    });
  });

  describe("undo all", () => {
    it("removes an empty manual container along with the other empty drafts", async () => {
      await h.service.getView(opsActor, "cust-1");
      await h.service.addContainer(opsActor, "cust-1");

      const view = await h.service.undoAll(opsActor, "cust-1");

      expect(labels(view)).toEqual(["Контейнер 1", "Контейнер 2", "OK to mix"]);
      expect(view.manualContainers).toBe(0);
      expect(h.containers.rows.some((c) => c.isManual)).toBe(false);
    });

    it("rolls back a manual container's positions like any other's, then removes it", async () => {
      const added = await h.service.addContainer(opsActor, "cust-1");
      await move(byLabel(added, "Контейнер 3").id, 60);
      await h.service.rename(
        byLabel(added, "Контейнер 3").id,
        "Доп",
        opsActor,
        "cust-1",
      );

      const view = await h.service.undoAll(opsActor, "cust-1");

      expect(labels(view)).toEqual(["Контейнер 1", "Контейнер 2", "OK to mix"]);
      expect(view.unallocatedLines).toEqual([
        expect.objectContaining({ piLineItemId: "li-A", remainingQty: 150 }),
      ]);
      expect(h.allocations.rows).toHaveLength(0);
      // Its name went with it: no slot of the plan inherits it.
      expect(view.containers.every((c) => c.name === null)).toBe(true);
    });

    it("keeps a manual container that holds a confirmed position, and still restores the plan's slots in full", async () => {
      const added = await h.service.addContainer(opsActor, "cust-1");
      const keptId = byLabel(added, "Контейнер 3").id;
      await move(keptId, 60);
      await h.confirm(opsActor);
      h.setLoadListStatus(LoadListStatus.DRAFT_CEAT);
      clock.tick();
      const second = await h.service.addContainer(opsActor, "cust-1"); // Контейнер 4
      await move(byLabel(second, "Контейнер 4").id, 10);

      const view = await h.service.undoAll(opsActor, "cust-1");

      expect(manual(view).map((c) => [c.label, c.isConfirmed])).toEqual([
        ["Контейнер 3", true],
      ]);
      expect(view.totalPossibleContainers).toBe(2);
      // Both slots of the plan are back (renumbered after the kept one).
      expect(planned(view)).toHaveLength(2);
      expect(view.unallocatedLines[0].remainingQty).toBe(90);
    });

    it("a new manual container after 'undo all' doesn't reuse the removed one's identity", async () => {
      const added = await h.service.addContainer(opsActor, "cust-1");
      const firstId = byLabel(added, "Контейнер 3").id;
      await h.service.undoAll(opsActor, "cust-1");

      const again = await h.service.addContainer(opsActor, "cust-1");

      expect(manual(again).map((c) => c.label)).toEqual(["Контейнер 3"]);
      expect(byLabel(again, "Контейнер 3").id).not.toBe(firstId);
    });

    it("the journal says how many manual containers went", async () => {
      await h.service.getView(opsActor, "cust-1");
      await h.service.addContainer(opsActor, "cust-1");
      await h.service.addContainer(opsActor, "cust-1");

      await h.service.undoAll(opsActor, "cust-1");
      await h.service.undoAll(opsActor, "cust-1"); // nothing manual left this time

      const undone = h.audit.entries.filter(
        (e) => e.action === "rts.undone_all",
      );
      expect(undone.map((e) => e.metadata)).toEqual([
        { positionsRolledBack: 0, manualContainersRemoved: 2 },
        { positionsRolledBack: 0 },
      ]);
    });
  });

  it("journals rts.container_added with the label, inside the transaction — and nothing when refused", async () => {
    await h.service.getView(opsActor, "cust-1");

    const view = await h.service.addContainer(opsActor, "cust-1");
    await failure(h.service.addContainer(clientActor));
    await failure(h.service.addContainer(opsActor));

    expect(h.audit.entries).toEqual([
      expect.objectContaining({
        actor: opsActor,
        action: "rts.container_added",
        entityType: "shipping_container",
        entityId: byLabel(view, "Контейнер 3").id,
        metadata: { containerLabel: "Контейнер 3", isManual: true },
        inTransaction: true,
      }),
    ]);
  });
});
