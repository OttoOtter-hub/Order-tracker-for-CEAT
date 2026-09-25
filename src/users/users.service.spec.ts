import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { makeFakeRepo } from "../common/testing/fake-repo";
import { FakeAudit, makeFakeAudit } from "../common/testing/fake-audit";
import { Role } from "../common/enums/role.enum";
import type { RequestUser } from "../common/auth/request-user.interface";
import { ACTIVE_CACHE_TTL_MS, UsersService } from "./users.service";

const ops: RequestUser = {
  id: "ops-1",
  email: "ops@ceat.com",
  role: Role.OPS,
  customerId: null,
};

function codeOf(error: unknown): unknown {
  return (error as HttpException).getResponse?.() as { code?: string };
}

describe("UsersService", () => {
  let customers: ReturnType<typeof makeFakeRepo>;
  let users: ReturnType<typeof makeFakeRepo>;
  let audit: FakeAudit;
  let service: UsersService;
  const createAsOps = (dto: Parameters<UsersService["create"]>[0]) =>
    service.create(dto, ops);

  beforeEach(() => {
    customers = makeFakeRepo();
    customers.seed({ id: "cust-1", name: "MTK ROSBERG LLC" });
    users = makeFakeRepo({ customer: () => customers });
    users.seed({
      id: "ops-1",
      email: "ops@ceat.com",
      passwordHash: "x",
      role: Role.OPS,
      customer: null,
      isActive: true,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    audit = makeFakeAudit();
    service = new UsersService(users as any, customers as any, audit as any);
  });

  it("journals creation, deactivation and reactivation — not a repeated no-op or a refusal", async () => {
    const created = await createAsOps({
      email: "Buyer3@MTK.com",
      password: "s3cret-pass",
      role: Role.CLIENT,
      customerId: "cust-1",
    });
    await service.setActive(created.id, false, ops);
    await service.setActive(created.id, false, ops); // already inactive
    await service.setActive(created.id, true, ops);
    await service.setActive("ops-1", false, ops).catch(() => undefined); // refused

    expect(audit.actions()).toEqual([
      "user.created",
      "user.deactivated",
      "user.reactivated",
    ]);
    expect(audit.entries[0]).toMatchObject({
      actor: ops,
      entityType: "user",
      entityId: created.id,
      metadata: {
        email: "buyer3@mtk.com",
        role: Role.CLIENT,
        customerName: "MTK ROSBERG LLC",
      },
    });
    expect(audit.entries[1]).toMatchObject({
      entityId: created.id,
      metadata: { email: "buyer3@mtk.com" },
    });
  });

  describe("create", () => {
    it("creates an ops user: hashed password, no customer, active, email normalized", async () => {
      const view = await createAsOps({
        email: "  New.Ops@CEAT.com ",
        password: "s3cret-pass",
        role: Role.OPS,
        customerId: "cust-1", // ignored for ops
      });

      expect(view).toMatchObject({
        email: "new.ops@ceat.com",
        role: Role.OPS,
        customer: null,
        isActive: true,
      });
      expect(view).not.toHaveProperty("passwordHash");
      const stored = users.rows.find((u) => u.email === "new.ops@ceat.com")!;
      expect(stored.passwordHash).not.toBe("s3cret-pass");
      expect(await bcrypt.compare("s3cret-pass", stored.passwordHash)).toBe(
        true,
      );
    });

    it("creates a client user tied to its customer", async () => {
      const view = await createAsOps({
        email: "buyer2@mtk.com",
        password: "s3cret-pass",
        role: Role.CLIENT,
        customerId: "cust-1",
      });

      expect(view.role).toBe(Role.CLIENT);
      expect(view.customer).toEqual({ id: "cust-1", name: "MTK ROSBERG LLC" });
    });

    it("400s a client without a customer, 404s an unknown customer", async () => {
      const noCustomer = createAsOps({
        email: "a@b.com",
        password: "s3cret-pass",
        role: Role.CLIENT,
      });
      await expect(noCustomer).rejects.toBeInstanceOf(BadRequestException);
      await noCustomer.catch((e) =>
        expect(codeOf(e)).toMatchObject({
          code: "CUSTOMER_REQUIRED_FOR_CLIENT",
        }),
      );

      await expect(
        createAsOps({
          email: "a@b.com",
          password: "s3cret-pass",
          role: Role.CLIENT,
          customerId: "cust-404",
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(users.rows).toHaveLength(1);
    });

    it("409s a duplicate email, whatever its case", async () => {
      const dup = createAsOps({
        email: "OPS@ceat.com",
        password: "s3cret-pass",
        role: Role.OPS,
      });
      await expect(dup).rejects.toBeInstanceOf(ConflictException);
      await dup.catch((e) =>
        expect(codeOf(e)).toMatchObject({ code: "EMAIL_TAKEN" }),
      );
    });
  });

  it("findAll lists every user without the password hash", async () => {
    await createAsOps({
      email: "buyer2@mtk.com",
      password: "s3cret-pass",
      role: Role.CLIENT,
      customerId: "cust-1",
    });

    const list = await service.findAll();
    expect(list.map((u) => u.email)).toEqual(
      expect.arrayContaining(["ops@ceat.com", "buyer2@mtk.com"]),
    );
    for (const u of list) {
      expect(Object.keys(u).sort()).toEqual(
        [
          "createdAt",
          "customer",
          "email",
          "id",
          "isActive",
          "isAdmin",
          "role",
        ].sort(),
      );
    }
  });

  describe("deactivate / reactivate", () => {
    beforeEach(() => {
      users.seed({
        id: "client-1",
        email: "buyer@mtk.com",
        passwordHash: "x",
        role: Role.CLIENT,
        customer: { id: "cust-1" },
        isActive: true,
      });
    });

    it("keeps the row and flips isActive both ways; isActive() follows at once", async () => {
      expect(await service.isActive("client-1")).toBe(true); // now cached

      const off = await service.setActive("client-1", false, ops);
      expect(off.isActive).toBe(false);
      expect(users.rows.find((u) => u.id === "client-1")).toMatchObject({
        isActive: false,
      });
      // The cached "true" from above is replaced, not waited out.
      expect(await service.isActive("client-1")).toBe(false);

      const on = await service.setActive("client-1", true, ops);
      expect(on.isActive).toBe(true);
      expect(await service.isActive("client-1")).toBe(true);
      expect(users.rows).toHaveLength(2);
    });

    it("refuses to let a user deactivate themselves", async () => {
      const self = service.setActive("ops-1", false, ops);
      await expect(self).rejects.toBeInstanceOf(BadRequestException);
      await self.catch((e) =>
        expect(codeOf(e)).toMatchObject({ code: "CANNOT_DEACTIVATE_SELF" }),
      );
      expect(users.rows.find((u) => u.id === "ops-1")!.isActive).toBe(true);
    });

    it("404s an unknown user", async () => {
      await expect(
        service.setActive("nobody", false, ops),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it("isActive: unknown user is inactive; a DB change is picked up after the TTL", async () => {
    jest.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") });
    try {
      expect(await service.isActive("nobody")).toBe(false);
      expect(await service.isActive("ops-1")).toBe(true);

      // Changed behind the service's back (e.g. another process).
      users.rows.find((u) => u.id === "ops-1")!.isActive = false;
      expect(await service.isActive("ops-1")).toBe(true); // still cached
      jest.advanceTimersByTime(ACTIVE_CACHE_TTL_MS + 1);
      expect(await service.isActive("ops-1")).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("notification recipients skip deactivated users", async () => {
    users.seed({
      id: "client-on",
      email: "on@mtk.com",
      role: Role.CLIENT,
      customer: { id: "cust-1" },
      isActive: true,
    });
    users.seed({
      id: "client-off",
      email: "off@mtk.com",
      role: Role.CLIENT,
      customer: { id: "cust-1" },
      isActive: false,
    });
    users.seed({
      id: "ops-off",
      email: "ops-off@ceat.com",
      role: Role.OPS,
      customer: null,
      isActive: false,
    });

    expect((await service.findClientUsers("cust-1")).map((u) => u.id)).toEqual([
      "client-on",
    ]);
    expect((await service.findOpsUsers()).map((u) => u.id)).toEqual(["ops-1"]);
  });
});
