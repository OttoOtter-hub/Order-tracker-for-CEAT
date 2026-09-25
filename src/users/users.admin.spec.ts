import { HttpException } from "@nestjs/common";
import { makeFakeRepo } from "../common/testing/fake-repo";
import { FakeAudit, makeFakeAudit } from "../common/testing/fake-audit";
import { Role } from "../common/enums/role.enum";
import type { RequestUser } from "../common/auth/request-user.interface";
import { JwtStrategy } from "../auth/jwt.strategy";
import { AddUserIsAdmin1790900000000 } from "../migrations/1790900000000-AddUserIsAdmin";
import { UsersService } from "./users.service";

const admin: RequestUser = {
  id: "ops-1",
  email: "ops@ceat.com",
  role: Role.OPS,
  customerId: null,
  isAdmin: true,
};

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 0, code: "no error" }),
    (e: unknown) => ({
      status: (e as HttpException).getStatus(),
      code: ((e as HttpException).getResponse() as { code?: string }).code,
    }),
  );

describe("UsersService — admin level (is_admin)", () => {
  let customers: ReturnType<typeof makeFakeRepo>;
  let users: ReturnType<typeof makeFakeRepo>;
  let audit: FakeAudit;
  let service: UsersService;
  const row = (id: string): any => users.rows.find((u: any) => u.id === id);

  beforeEach(() => {
    customers = makeFakeRepo();
    customers.seed({ id: "cust-1", name: "MTK ROSBERG LLC" });
    users = makeFakeRepo({ customer: () => customers });
    const base = { passwordHash: "x", customer: null, isActive: true };
    users.seed({
      ...base,
      id: "ops-1",
      email: "ops@ceat.com",
      role: Role.OPS,
      isAdmin: true,
    });
    users.seed({
      ...base,
      id: "ops-2",
      email: "ops2@ceat.com",
      role: Role.OPS,
      isAdmin: false,
    });
    users.seed({
      ...base,
      id: "client-1",
      email: "buyer@mtk.com",
      role: Role.CLIENT,
      customer: { id: "cust-1" },
      isAdmin: false,
    });
    audit = makeFakeAudit();
    service = new UsersService(users as any, customers as any, audit as any);
  });

  describe("POST /users with isAdmin", () => {
    it("an admin can create another admin; the view and the journal say so", async () => {
      const created = await service.create(
        {
          email: "boss@ceat.com",
          password: "s3cret-pass",
          role: Role.OPS,
          isAdmin: true,
        },
        admin,
      );

      expect(created.isAdmin).toBe(true);
      expect(row(created.id).isAdmin).toBe(true);
      expect(audit.entries[0]).toMatchObject({
        action: "user.created",
        metadata: { email: "boss@ceat.com", role: Role.OPS, isAdmin: true },
      });
    });

    it("isAdmin is optional and defaults to false", async () => {
      const created = await service.create(
        { email: "plain@ceat.com", password: "s3cret-pass", role: Role.OPS },
        admin,
      );
      expect(created.isAdmin).toBe(false);
      expect(row(created.id).isAdmin).toBe(false);
    });

    it("a client can't be created as an admin (400 ADMIN_REQUIRES_OPS), nothing saved", async () => {
      expect(
        await failure(
          service.create(
            {
              email: "buyer2@mtk.com",
              password: "s3cret-pass",
              role: Role.CLIENT,
              customerId: "cust-1",
              isAdmin: true,
            },
            admin,
          ),
        ),
      ).toEqual({ status: 400, code: "ADMIN_REQUIRES_OPS" });
      expect(users.rows.some((u: any) => u.email === "buyer2@mtk.com")).toBe(
        false,
      );
      expect(audit.entries).toHaveLength(0);
    });
  });

  describe("PATCH /users/:id/set-admin", () => {
    it("grants admin to another ops user, journaled once; setting it again is a no-op", async () => {
      const view = await service.setAdmin("ops-2", true, admin);
      await service.setAdmin("ops-2", true, admin);

      expect(view.isAdmin).toBe(true);
      expect(row("ops-2").isAdmin).toBe(true);
      expect(audit.actions()).toEqual(["user.admin_granted"]);
      expect(audit.entries[0]).toMatchObject({
        actor: admin,
        entityType: "user",
        entityId: "ops-2",
        metadata: { email: "ops2@ceat.com" },
      });
    });

    it("revokes admin while another active admin remains", async () => {
      await service.setAdmin("ops-2", true, admin);
      const view = await service.setAdmin("ops-1", false, admin); // itself

      expect(view.isAdmin).toBe(false);
      expect(audit.actions()).toEqual([
        "user.admin_granted",
        "user.admin_revoked",
      ]);
    });

    it("the last active admin can't lose it (400 LAST_ADMIN) — not even by their own hand", async () => {
      expect(await failure(service.setAdmin("ops-1", false, admin))).toEqual({
        status: 400,
        code: "LAST_ADMIN",
      });
      expect(row("ops-1").isAdmin).toBe(true);
      expect(audit.entries).toHaveLength(0);
    });

    it("once two admins become one again, that one is protected", async () => {
      await service.setAdmin("ops-2", true, admin);
      await service.setAdmin("ops-1", false, admin);
      const ops2: RequestUser = {
        ...admin,
        id: "ops-2",
        email: "ops2@ceat.com",
      };

      expect(await failure(service.setAdmin("ops-2", false, ops2))).toEqual({
        status: 400,
        code: "LAST_ADMIN",
      });
    });

    it("a deactivated admin doesn't count toward keeping someone else's access, and can itself be revoked", async () => {
      users.seed({
        id: "ops-3",
        email: "gone@ceat.com",
        passwordHash: "x",
        role: Role.OPS,
        customer: null,
        isActive: false,
        isAdmin: true,
      });

      expect(await failure(service.setAdmin("ops-1", false, admin))).toEqual({
        status: 400,
        code: "LAST_ADMIN",
      });
      expect((await service.setAdmin("ops-3", false, admin)).isAdmin).toBe(
        false,
      );
    });

    it("only an ops user can be an admin (400 ADMIN_REQUIRES_OPS); unknown id is 404", async () => {
      expect(await failure(service.setAdmin("client-1", true, admin))).toEqual({
        status: 400,
        code: "ADMIN_REQUIRES_OPS",
      });
      expect(
        await failure(
          service.setAdmin("00000000-0000-4000-8000-000000000000", true, admin),
        ),
      ).toEqual({ status: 404, code: "NOT_FOUND" });
      expect(row("client-1").isAdmin).toBe(false);
    });

    it("the list shows who is an admin", async () => {
      const list = await service.findAll();
      expect(list.map((u) => [u.email, u.isAdmin])).toEqual(
        expect.arrayContaining([
          ["ops@ceat.com", true],
          ["ops2@ceat.com", false],
          ["buyer@mtk.com", false],
        ]),
      );
    });
  });

  describe("auth status (what JwtStrategy sees)", () => {
    it("reflects a grant or revoke immediately (the cache is written through)", async () => {
      expect(await service.getAuthStatus("ops-2")).toEqual({
        active: true,
        isAdmin: false,
      });
      await service.setAdmin("ops-2", true, admin);
      expect(await service.getAuthStatus("ops-2")).toEqual({
        active: true,
        isAdmin: true,
      });
      await service.setAdmin("ops-2", false, admin);
      expect(await service.getAuthStatus("ops-2")).toEqual({
        active: true,
        isAdmin: false,
      });
    });

    it("a client is never an admin, whatever the row says; an unknown id is inactive", async () => {
      row("client-1").isAdmin = true;
      expect(await service.getAuthStatus("client-1")).toEqual({
        active: true,
        isAdmin: false,
      });
      expect(await service.getAuthStatus("nobody")).toEqual({
        active: false,
        isAdmin: false,
      });
    });

    it("JwtStrategy takes isAdmin from the database, not from the token", async () => {
      const strategy = new JwtStrategy(
        { get: (_key: string, fallback: string) => fallback } as any,
        service,
      );
      const payload = {
        sub: "ops-2",
        email: "ops2@ceat.com",
        role: Role.OPS,
        customerId: null,
      };

      // The token claims admin, the database says no.
      expect(
        await strategy.validate({ ...payload, isAdmin: true }),
      ).toMatchObject({
        id: "ops-2",
        isAdmin: false,
      });
      await service.setAdmin("ops-2", true, admin);
      // An old token without the claim still gets the fresh value.
      expect(await strategy.validate(payload)).toMatchObject({ isAdmin: true });
    });
  });
});

describe("migration AddUserIsAdmin", () => {
  it("adds the column (default false), limits it to ops, and makes exactly one existing user an admin: the earliest-created active ops user", async () => {
    const queries: string[] = [];
    await new AddUserIsAdmin1790900000000().up({
      query: async (sql: string) => {
        queries.push(sql.replace(/\s+/g, " ").trim());
      },
    } as any);

    expect(queries[0]).toBe(
      `ALTER TABLE "users" ADD COLUMN "is_admin" boolean NOT NULL DEFAULT false`,
    );
    expect(queries[1]).toContain(`CHECK (NOT "is_admin" OR "role" = 'ops')`);
    expect(queries[2]).toBe(
      `UPDATE "users" SET "is_admin" = true WHERE "id" = ( SELECT "id" FROM "users" WHERE "role" = 'ops' ORDER BY "is_active" DESC, "created_at" ASC, "id" ASC LIMIT 1 )`,
    );
    expect(queries).toHaveLength(3);
  });

  it("down() removes the constraint and the column", async () => {
    const queries: string[] = [];
    await new AddUserIsAdmin1790900000000().down({
      query: async (sql: string) => {
        queries.push(sql);
      },
    } as any);
    expect(queries).toEqual([
      `ALTER TABLE "users" DROP CONSTRAINT "chk_users_admin_is_ops"`,
      `ALTER TABLE "users" DROP COLUMN "is_admin"`,
    ]);
  });
});
