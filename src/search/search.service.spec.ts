import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { makeFakeRepo } from "../common/testing/fake-repo";
import { Role } from "../common/enums/role.enum";
import type { RequestUser } from "../common/auth/request-user.interface";
import { ProformaInvoice } from "../proforma-invoices/proforma-invoice.entity";
import { PiStatus } from "../proforma-invoices/enums/pi-status.enum";
import { SEARCH_LIMIT_PER_SOURCE, SearchService } from "./search.service";

describe("SearchService", () => {
  let piRepo: ReturnType<typeof makeFakeRepo>;
  let lineItemRepo: ReturnType<typeof makeFakeRepo>;
  let allocationRepo: ReturnType<typeof makeFakeRepo>;
  let dispatchRepo: ReturnType<typeof makeFakeRepo>;
  let service: SearchService;

  const opsActor: RequestUser = {
    id: "ops-1",
    email: "ops@ceat.com",
    role: Role.OPS,
    customerId: null,
  };
  const clientActor: RequestUser = {
    id: "client-1",
    email: "buyer@one.com",
    role: Role.CLIENT,
    customerId: "cust-1",
  };
  const otherClientActor: RequestUser = {
    id: "client-2",
    email: "buyer@two.com",
    role: Role.CLIENT,
    customerId: "cust-2",
  };

  beforeEach(() => {
    piRepo = makeFakeRepo();
    lineItemRepo = makeFakeRepo();
    allocationRepo = makeFakeRepo();
    dispatchRepo = makeFakeRepo();
    service = new SearchService(
      piRepo as any,
      lineItemRepo as any,
      allocationRepo as any,
      dispatchRepo as any,
    );
  });

  function seedCard(
    id: string,
    piNumber: string,
    customerId: string,
    overrides: Record<string, any> = {},
  ): ProformaInvoice {
    const card = Object.assign(new ProformaInvoice(), {
      id,
      piNumber,
      label: null,
      customer: { id: customerId },
      isArchivedShipped: false,
      piFileUrl: "/files/pi.pdf",
      signedFileUrl: null,
      pendingReplacementFileUrl: null,
      ...overrides,
    });
    piRepo.seed(card as any);
    return card;
  }

  function seedLine(
    id: string,
    card: ProformaInvoice,
    materialNum: string | null,
    materialDesc: string | null,
  ) {
    const line = { id, pi: { id: card.id }, materialNum, materialDesc };
    lineItemRepo.seed(line as any);
    return line;
  }

  function seedAllocation(
    id: string,
    container: Record<string, any>,
    line: Record<string, any>,
    isLocked = false,
  ) {
    allocationRepo.seed({
      id,
      container,
      piLineItem: line,
      allocatedQty: "10",
      isLocked,
    } as any);
  }

  function seedDispatch(
    id: string,
    container: Record<string, any>,
    piNumber: string | null,
    materialNum: string | null,
    materialDesc: string | null,
  ) {
    dispatchRepo.seed({
      id,
      actualContainer: container,
      piNumber,
      materialNum,
      materialDesc,
      quantity: "5",
    } as any);
  }

  const containerOf = (id: string, customerId: string, extra = {}) => ({
    id,
    label: `Контейнер ${id}`,
    name: null,
    isOkToMix: false,
    customer: { id: customerId },
    ...extra,
  });
  const shippedOf = (id: string, customerId: string) => ({
    id,
    containerNumber: `MSKU${id}`,
    customer: { id: customerId },
  });

  /** One material in all three places for cust-1, and a lookalike for cust-2. */
  function seedEverywhere() {
    const card = seedCard("pi-1", "100037320", "cust-1", { label: "Ростов" });
    const line = seedLine(
      "li-1",
      card,
      "107071",
      "205/55 R16 CEAT SecuraDrive",
    );
    seedAllocation("al-1", containerOf("c-1", "cust-1"), line, true);
    seedDispatch(
      "d-1",
      shippedOf("a-1", "cust-1"),
      "100037320",
      "107071",
      "205/55 R16 CEAT SecuraDrive",
    );

    const foreign = seedCard("pi-9", "100099999", "cust-2");
    const foreignLine = seedLine(
      "li-9",
      foreign,
      "107071",
      "205/55 R16 CEAT SecuraDrive",
    );
    seedAllocation("al-9", containerOf("c-9", "cust-2"), foreignLine);
    seedDispatch(
      "d-9",
      shippedOf("a-9", "cust-2"),
      "100099999",
      "107071",
      "205/55 R16 CEAT SecuraDrive",
    );
  }

  it("finds an exact material number in all three sections, with where each hit leads", async () => {
    seedEverywhere();

    const result = await service.search(clientActor, "107071");

    expect(result.pi).toEqual({
      items: [
        {
          piId: "pi-1",
          piNumber: "100037320",
          piLabel: "Ростов",
          status: PiStatus.MISSING_SIGNED_DOCUMENT,
          isShippedOnly: false,
          customerId: "cust-1",
          materialNum: "107071",
          materialDesc: "205/55 R16 CEAT SecuraDrive",
        },
      ],
      truncated: false,
    });
    expect(result.readyToShip.items).toEqual([
      expect.objectContaining({
        containerId: "c-1",
        containerLabel: "Контейнер c-1",
        isConfirmed: true,
        customerId: "cust-1",
        materialNum: "107071",
      }),
    ]);
    expect(result.shipped.items).toEqual([
      {
        actualContainerId: "a-1",
        containerNumber: "MSKUa-1",
        customerId: "cust-1",
        materialNum: "107071",
        materialDesc: "205/55 R16 CEAT SecuraDrive",
      },
    ]);
  });

  it("matches a part of the material number, and a part of the description in any case", async () => {
    seedEverywhere();

    const byNumberPart = await service.search(clientActor, "0707");
    const bySize = await service.search(clientActor, "  r16 ceat ");

    for (const result of [byNumberPart, bySize]) {
      expect(result.pi.items.map((h) => h.piId)).toEqual(["pi-1"]);
      expect(result.readyToShip.items.map((h) => h.containerId)).toEqual([
        "c-1",
      ]);
      expect(result.shipped.items.map((h) => h.actualContainerId)).toEqual([
        "a-1",
      ]);
    }
    expect(bySize.query).toBe("r16 ceat");
  });

  it("finds nothing for an empty query, or for text that matches no material", async () => {
    seedEverywhere();

    for (const query of [undefined, "", "   ", "999999", "R17"]) {
      const result = await service.search(clientActor, query);
      expect(result.pi.items).toEqual([]);
      expect(result.readyToShip.items).toEqual([]);
      expect(result.shipped.items).toEqual([]);
    }
  });

  it("takes % and _ literally, not as wildcards", async () => {
    seedEverywhere();
    const card = piRepo.rows[0] as ProformaInvoice;
    seedLine("li-2", card, "200001", "Tube 10% extra");

    expect(
      (await service.search(clientActor, "%")).pi.items.map(
        (h) => h.materialNum,
      ),
    ).toEqual(["200001"]);
    expect((await service.search(clientActor, "_")).pi.items).toEqual([]);
  });

  describe("customer scope", () => {
    it("a client sees only their own customer's hits", async () => {
      seedEverywhere();

      const own = await service.search(clientActor, "107071");
      const other = await service.search(otherClientActor, "107071");

      expect(own.pi.items.map((h) => h.piId)).toEqual(["pi-1"]);
      expect(own.readyToShip.items.map((h) => h.containerId)).toEqual(["c-1"]);
      expect(own.shipped.items.map((h) => h.actualContainerId)).toEqual([
        "a-1",
      ]);
      expect(other.pi.items.map((h) => h.piId)).toEqual(["pi-9"]);
      expect(other.readyToShip.items.map((h) => h.containerId)).toEqual([
        "c-9",
      ]);
      expect(other.shipped.items.map((h) => h.actualContainerId)).toEqual([
        "a-9",
      ]);
    });

    it("a client naming another customer gets a 404; one without a customer a 403", async () => {
      seedEverywhere();

      await expect(
        service.search(clientActor, "107071", "cust-2"),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.search({ ...clientActor, customerId: null }, "107071"),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // Naming their own customer is fine.
      const own = await service.search(clientActor, "107071", "cust-1");
      expect(own.pi.items.map((h) => h.piId)).toEqual(["pi-1"]);
    });

    it("ops sees the customer they ask for, or every customer when they name none", async () => {
      seedEverywhere();

      const asked = await service.search(opsActor, "107071", "cust-2");
      const all = await service.search(opsActor, "107071");

      expect(asked.pi.items.map((h) => h.piId)).toEqual(["pi-9"]);
      expect(asked.readyToShip.items.map((h) => h.containerId)).toEqual([
        "c-9",
      ]);
      expect(asked.shipped.items.map((h) => h.actualContainerId)).toEqual([
        "a-9",
      ]);
      expect(all.pi.items.map((h) => h.customerId)).toEqual([
        "cust-1",
        "cust-2",
      ]);
      expect(all.readyToShip.items).toHaveLength(2);
      expect(all.shipped.items).toHaveLength(2);
    });
  });

  describe("PI cards", () => {
    it("skips archived cards", async () => {
      const archived = seedCard("pi-a", "100000001", "cust-1", {
        isArchivedShipped: true,
      });
      seedLine("li-a", archived, "107071", "205/55 R16");

      const result = await service.search(clientActor, "107071");

      expect(result.pi.items).toEqual([]);
    });

    it("finds a fully shipped material (Dispatch only) as isShippedOnly, and doesn't repeat one the backorder still has", async () => {
      const card = seedCard("pi-1", "100037320", "cust-1");
      seedLine("li-1", card, "107071", "205/55 R16 SecuraDrive");
      seedLine("li-2", card, "107071", "205/55 R16 SecuraDrive"); // 2nd SO row
      seedLine("li-3", card, "300300", "Tube 16");
      const shipped = shippedOf("a-1", "cust-1");
      seedDispatch(
        "d-1",
        shipped,
        "100037320",
        "107071",
        "205/55 R16 SecuraDrive",
      );
      // In the backorder, but Dispatch spells it differently.
      seedDispatch(
        "d-2",
        shipped,
        "100037320",
        "300300",
        "R16 tube (dispatch)",
      );
      seedDispatch(
        "d-3",
        shipped,
        "100037320",
        "555555",
        "215/60 R16 FuelSmarrt",
      );
      // Dispatch of a PI that has no card here — not a PI hit.
      seedDispatch("d-4", shipped, "100000404", "555556", "225/60 R16");

      const result = await service.search(clientActor, "R16");

      expect(
        result.pi.items.map((h) => [h.materialNum, h.isShippedOnly]),
      ).toEqual([
        ["107071", false],
        ["300300", false],
        ["555555", true],
      ]);
      expect(result.shipped.items.map((h) => h.materialNum)).toEqual([
        "107071",
        "300300",
        "555555",
        "555556",
      ]);
    });
  });

  it("a container is confirmed only when every position of the material in it is locked", async () => {
    const card = seedCard("pi-1", "100037320", "cust-1");
    const line1 = seedLine("li-1", card, "107071", "205/55 R16");
    const line2 = seedLine("li-2", card, "107071", "205/55 R16");
    const container = containerOf("c-1", "cust-1", { name: "Ростов" });
    seedAllocation("al-1", container, line1, true);
    seedAllocation("al-2", container, line2, false);

    const result = await service.search(clientActor, "107071");

    expect(result.readyToShip.items).toEqual([
      expect.objectContaining({
        containerId: "c-1",
        containerName: "Ростов",
        isConfirmed: false,
      }),
    ]);
  });

  describe("limit per section", () => {
    function seedMaterials(count: number) {
      const card = seedCard("pi-1", "100037320", "cust-1");
      const shipped = shippedOf("a-1", "cust-1");
      for (let i = 0; i < count; i++) {
        const material = String(700000 + i);
        const line = seedLine(`li-${i}`, card, material, `Tyre ${i} R16`);
        seedAllocation(`al-${i}`, containerOf(`c-${i}`, "cust-1"), line);
        seedDispatch(`d-${i}`, shipped, "100037320", material, `Tyre ${i} R16`);
      }
    }

    it(`returns at most ${SEARCH_LIMIT_PER_SOURCE} hits per section and says there were more`, async () => {
      seedMaterials(SEARCH_LIMIT_PER_SOURCE + 5);

      const result = await service.search(clientActor, "R16");

      for (const section of [result.pi, result.readyToShip, result.shipped]) {
        expect(section.items).toHaveLength(SEARCH_LIMIT_PER_SOURCE);
        expect(section.truncated).toBe(true);
      }
      // Sorted by material number, so the first ones are kept.
      expect(result.pi.items[0].materialNum).toBe("700000");
    });

    it("isn't truncated at exactly the limit", async () => {
      seedMaterials(SEARCH_LIMIT_PER_SOURCE);

      const result = await service.search(clientActor, "R16");

      for (const section of [result.pi, result.readyToShip, result.shipped]) {
        expect(section.items).toHaveLength(SEARCH_LIMIT_PER_SOURCE);
        expect(section.truncated).toBe(false);
      }
    });
  });
});
