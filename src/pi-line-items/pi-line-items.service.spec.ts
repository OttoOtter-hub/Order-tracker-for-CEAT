import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { makeFakeRepo } from "../common/testing/fake-repo";
import { PiLineItemsService } from "./pi-line-items.service";
import { Role } from "../common/enums/role.enum";
import type { RequestUser } from "../common/auth/request-user.interface";

describe("PiLineItemsService", () => {
  let repo: ReturnType<typeof makeFakeRepo>;
  let service: PiLineItemsService;

  const opsActor: RequestUser = {
    id: "ops-1",
    email: "ops@ceat.com",
    role: Role.OPS,
    customerId: null,
  };
  const clientActor: RequestUser = {
    id: "client-1",
    email: "buyer@mtkrosberg.com",
    role: Role.CLIENT,
    customerId: "cust-1",
  };
  const otherClientActor: RequestUser = {
    id: "client-2",
    email: "buyer@othercustomer.com",
    role: Role.CLIENT,
    customerId: "cust-2",
  };

  beforeEach(() => {
    repo = makeFakeRepo();
    service = new PiLineItemsService(repo as any);
  });

  function seedLineItem(overrides: Record<string, any> = {}) {
    return repo.seed({
      id: "li-1",
      pi: { id: "pi-1", customer: { id: "cust-1" } },
      soNumber: "300029159",
      materialNum: "107071",
      balanceToBeDelivered: "10.00",
      priorityQty: "0",
      ...overrides,
    } as any);
  }

  describe("updatePriority", () => {
    it("saves a priorityQty within [0, balanceToBeDelivered]", async () => {
      seedLineItem();

      const updated = await service.updatePriority("li-1", 7, clientActor);

      expect(updated.priorityQty).toBe("7");
      expect(repo.rows[0].priorityQty).toBe("7");
    });

    it("rejects a priorityQty greater than the row's balanceToBeDelivered with 400", async () => {
      seedLineItem({ balanceToBeDelivered: "10.00" });

      await expect(
        service.updatePriority("li-1", 11, clientActor),
      ).rejects.toBeInstanceOf(BadRequestException);
      // Nothing was written.
      expect(repo.rows[0].priorityQty).toBe("0");
    });

    it("allows priorityQty exactly equal to balanceToBeDelivered", async () => {
      seedLineItem({ balanceToBeDelivered: "10.00" });

      const updated = await service.updatePriority("li-1", 10, clientActor);

      expect(updated.priorityQty).toBe("10");
    });

    it("blocks a client whose customer doesn't own the line item's PI, with 404 (not 403)", async () => {
      seedLineItem(); // pi.customer.id === "cust-1"

      await expect(
        service.updatePriority("li-1", 5, otherClientActor),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.rows[0].priorityQty).toBe("0");
    });

    it("404s on an unknown line item id", async () => {
      await expect(
        service.updatePriority("does-not-exist", 5, clientActor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects an ops actor outright — priority is a client-only action", async () => {
      seedLineItem();

      await expect(
        service.updatePriority("li-1", 5, opsActor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.rows[0].priorityQty).toBe("0");
    });

    it("rejects a fractional priorityQty with 400 — whole tires only", async () => {
      seedLineItem();

      await expect(
        service.updatePriority("li-1", 0.02, clientActor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.rows[0].priorityQty).toBe("0");
    });

    it("allows a whole-number priorityQty within range", async () => {
      seedLineItem({ balanceToBeDelivered: "10.00" });

      const updated = await service.updatePriority("li-1", 10, clientActor);

      expect(updated.priorityQty).toBe("10");
    });
  });
});
