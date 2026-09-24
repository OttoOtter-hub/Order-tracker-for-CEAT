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
 * Phase 22 — the client's own name for a numbered container.
 *
 * Line A: 150 units, 100 per container -> 2 numbered slots (+ OK to mix).
 */
describe("ReadyToShipService.rename (container name)", () => {
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
  });

  afterEach(() => clock.restore());

  const numbered = (view: ReadyToShipView) =>
    view.containers.filter((c) => !c.isOkToMix);
  const okToMixOf = (view: ReadyToShipView) =>
    view.containers.find((c) => c.isOkToMix)!;
  const nameOf = (view: ReadyToShipView, label: string) =>
    view.containers.find((c) => c.label === label)?.name;

  it("every container starts without a name", async () => {
    const view = await h.service.getView(clientActor);

    expect(view.containers.map((c) => [c.label, c.name])).toEqual([
      ["Контейнер 1", null],
      ["Контейнер 2", null],
      ["OK to mix", null],
    ]);
  });

  it("the owning client names a numbered container (trimmed), and the view carries it", async () => {
    const view = await h.service.getView(clientActor);
    const second = numbered(view)[1];

    const renamed = await h.service.rename(
      second.id,
      "  Ростов  ",
      clientActor,
    );

    expect(nameOf(renamed, "Контейнер 2")).toBe("Ростов");
    expect(nameOf(renamed, "Контейнер 1")).toBeNull();
    expect(nameOf(await h.service.getView(clientActor), "Контейнер 2")).toBe(
      "Ростов",
    );
    // Ops sees the same name (read-only).
    expect(
      nameOf(await h.service.getView(opsActor, "cust-1"), "Контейнер 2"),
    ).toBe("Ростов");
  });

  it("an empty or blank name (or null) clears it", async () => {
    const id = numbered(await h.service.getView(clientActor))[0].id;
    await h.service.rename(id, "Ростов", clientActor);

    expect(
      nameOf(await h.service.rename(id, "   ", clientActor), "Контейнер 1"),
    ).toBeNull();
    await h.service.rename(id, "Ростов", clientActor);
    expect(
      nameOf(await h.service.rename(id, null, clientActor), "Контейнер 1"),
    ).toBeNull();
  });

  it("is journaled in the same transaction, with the old and the new name, and not when nothing changed", async () => {
    const id = numbered(await h.service.getView(clientActor))[0].id;

    await h.service.rename(id, "Ростов", clientActor);
    await h.service.rename(id, "Ростов", clientActor); // no change
    await h.service.rename(id, "Казань", clientActor);

    expect(h.audit.entries).toEqual([
      expect.objectContaining({
        action: "rts.container_renamed",
        entityType: "shipping_container",
        entityId: id,
        metadata: { containerLabel: "Контейнер 1", from: null, to: "Ростов" },
        inTransaction: true,
      }),
      expect.objectContaining({
        action: "rts.container_renamed",
        metadata: {
          containerLabel: "Контейнер 1",
          from: "Ростов",
          to: "Казань",
        },
      }),
    ]);
  });

  it("the OK to mix container cannot be named: 400 OK_TO_MIX_NAME_NOT_ALLOWED, nothing written", async () => {
    const okToMix = okToMixOf(await h.service.getView(clientActor));

    expect(
      await failure(h.service.rename(okToMix.id, "Микс", clientActor)),
    ).toEqual({ status: 400, code: "OK_TO_MIX_NAME_NOT_ALLOWED" });
    expect(okToMixOf(await h.service.getView(clientActor)).name).toBeNull();
    expect(h.audit.entries).toHaveLength(0);
  });

  it("only the owning client: another customer's client gets a 404, ops a 403, nothing written", async () => {
    const id = numbered(await h.service.getView(clientActor))[0].id;

    expect(
      await failure(h.service.rename(id, "Чужой", otherClientActor)),
    ).toEqual({ status: 404, code: "NOT_FOUND" });
    expect(await failure(h.service.rename(id, "CEAT", opsActor))).toEqual({
      status: 403,
      code: "CLIENT_ONLY_ACTION",
    });
    expect(
      nameOf(await h.service.getView(clientActor), "Контейнер 1"),
    ).toBeNull();
    expect(h.audit.entries).toHaveLength(0);
  });

  it("an unknown container is a 404", async () => {
    expect(
      await failure(
        h.service.rename(
          "00000000-0000-4000-8000-000000000000",
          "Ростов",
          clientActor,
        ),
      ),
    ).toEqual({ status: 404, code: "NOT_FOUND" });
  });

  it("is a note, not part of the plan: a confirmed container can still be renamed", async () => {
    const id = numbered(await h.service.getView(clientActor))[0].id;
    clock.tick();
    await h.service.move(
      { piLineItemId: "li-A", containerId: id, qty: 100 },
      clientActor,
    );
    await h.service.confirm(clientActor);

    const renamed = await h.service.rename(id, "Ростов", clientActor);

    const container = renamed.containers.find((c) => c.id === id)!;
    expect(container.isConfirmed).toBe(true);
    expect(container.name).toBe("Ростов");
  });

  it("undo-all recycles empty slots, but a slot that comes back under the same label keeps its name", async () => {
    const [first, second] = numbered(await h.service.getView(clientActor));
    await h.service.rename(first.id, "Ростов", clientActor);
    await h.service.rename(second.id, "Казань", clientActor);
    clock.tick();
    await h.service.move(
      { piLineItemId: "li-A", containerId: first.id, qty: 50 },
      clientActor,
    );

    const afterUndo = await h.service.undoAll(clientActor);

    expect(
      numbered(afterUndo).map((c) => [c.label, c.name, c.id === first.id]),
    ).toEqual([
      ["Контейнер 1", "Ростов", false], // recreated, name carried over
      ["Контейнер 2", "Казань", false],
    ]);
  });
});
