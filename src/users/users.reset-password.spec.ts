import { HttpException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { makeFakeRepo } from "../common/testing/fake-repo";
import { FakeAudit, makeFakeAudit } from "../common/testing/fake-audit";
import { Role } from "../common/enums/role.enum";
import type { RequestUser } from "../common/auth/request-user.interface";
import {
  PASSWORD_HASH_ROUNDS,
  TEMP_PASSWORD_LENGTH,
  UsersService,
  generateTemporaryPassword,
} from "./users.service";

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

describe("UsersService.resetPassword (admin resets someone else's password)", () => {
  let users: ReturnType<typeof makeFakeRepo>;
  let audit: FakeAudit;
  let service: UsersService;
  let oldHash: string;
  const row = (id: string): any => users.rows.find((u: any) => u.id === id);

  beforeEach(async () => {
    const customers = makeFakeRepo();
    customers.seed({ id: "cust-1", name: "MTK ROSBERG LLC" });
    users = makeFakeRepo({ customer: () => customers });
    oldHash = await bcrypt.hash("old-password-1", 4);
    users.seed({
      id: "ops-1",
      email: "ops@ceat.com",
      passwordHash: oldHash,
      role: Role.OPS,
      customer: null,
      isActive: true,
      isAdmin: true,
    });
    users.seed({
      id: "ops-2",
      email: "rustam@ceat.com",
      passwordHash: oldHash,
      role: Role.OPS,
      customer: null,
      isActive: true,
      isAdmin: false,
    });
    users.seed({
      id: "client-1",
      email: "buyer@mtk.com",
      passwordHash: oldHash,
      role: Role.CLIENT,
      customer: { id: "cust-1" },
      isActive: true,
      isAdmin: false,
    });
    audit = makeFakeAudit();
    service = new UsersService(users as any, customers as any, audit as any);
  });

  it("replaces the password with a random temporary one, returned once; the old one stops working", async () => {
    const { user, temporaryPassword } = await service.resetPassword(
      "ops-2",
      admin,
    );

    expect(user).toMatchObject({ id: "ops-2", email: "rustam@ceat.com" });
    expect(temporaryPassword).toMatch(
      new RegExp(`^[A-HJ-NP-Za-km-z2-9]{${TEMP_PASSWORD_LENGTH}}$`),
    );
    const stored = row("ops-2").passwordHash;
    expect(bcrypt.getRounds(stored)).toBe(PASSWORD_HASH_ROUNDS);
    expect(await bcrypt.compare(temporaryPassword, stored)).toBe(true);
    expect(await bcrypt.compare("old-password-1", stored)).toBe(false);
    expect(stored).not.toContain(temporaryPassword);
  });

  it("works for a client too", async () => {
    const { temporaryPassword } = await service.resetPassword(
      "client-1",
      admin,
    );
    expect(
      await bcrypt.compare(temporaryPassword, row("client-1").passwordHash),
    ).toBe(true);
  });

  it("is journaled — who and whose, never the password", async () => {
    const { temporaryPassword } = await service.resetPassword("ops-2", admin);

    expect(audit.entries).toEqual([
      expect.objectContaining({
        actor: admin,
        action: "user.password_reset",
        entityType: "user",
        entityId: "ops-2",
        metadata: { email: "rustam@ceat.com", role: Role.OPS },
      }),
    ]);
    expect(JSON.stringify(audit.entries)).not.toContain(temporaryPassword);
  });

  it("your own password goes through change-password: 400 CANNOT_RESET_OWN_PASSWORD, nothing changed", async () => {
    expect(await failure(service.resetPassword("ops-1", admin))).toEqual({
      status: 400,
      code: "CANNOT_RESET_OWN_PASSWORD",
    });
    expect(row("ops-1").passwordHash).toBe(oldHash);
    expect(audit.entries).toHaveLength(0);
  });

  it("an unknown user is a 404", async () => {
    expect(
      await failure(
        service.resetPassword("00000000-0000-4000-8000-000000000000", admin),
      ),
    ).toEqual({ status: 404, code: "NOT_FOUND" });
  });

  it("temporary passwords are random and long enough for the login rules", () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => generateTemporaryPassword()),
    );
    expect(seen.size).toBe(50);
    for (const pw of seen) expect(pw.length).toBeGreaterThanOrEqual(8);
  });
});
