import {
  BadRequestException,
  HttpException,
  UnauthorizedException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { makeFakeRepo } from "../common/testing/fake-repo";
import { makeFakeAudit } from "../common/testing/fake-audit";
import { Role } from "../common/enums/role.enum";
import type { RequestUser } from "../common/auth/request-user.interface";
import { UsersService } from "../users/users.service";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";

const codeOf = (error: unknown) =>
  ((error as HttpException).getResponse() as { code?: string }).code;

describe("AuthService + JwtStrategy (Phase 20a)", () => {
  let users: ReturnType<typeof makeFakeRepo>;
  let usersService: UsersService;
  let auth: AuthService;
  let strategy: JwtStrategy;

  const actor = (id: string): RequestUser => ({
    id,
    email: `${id}@x.com`,
    role: Role.CLIENT,
    customerId: "cust-1",
  });

  beforeEach(async () => {
    users = makeFakeRepo();
    for (const [id, email, password, isActive] of [
      ["u-active", "active@x.com", "old-password", true],
      ["u-other", "other@x.com", "other-password", true],
      ["u-off", "off@x.com", "off-password", false],
    ] as const) {
      users.seed({
        id,
        email,
        passwordHash: await bcrypt.hash(password, 4),
        role: Role.CLIENT,
        customer: { id: "cust-1" },
        isActive,
      });
    }
    usersService = new UsersService(
      users as any,
      makeFakeRepo() as any,
      makeFakeAudit() as any,
    );
    auth = new AuthService(usersService, { sign: () => "token" } as any);
    strategy = new JwtStrategy(
      { get: () => "test-secret" } as any,
      usersService,
    );
  });

  describe("login", () => {
    it("lets an active user in", async () => {
      await expect(
        auth.validateUser("active@x.com", "old-password"),
      ).resolves.toMatchObject({ id: "u-active" });
    });

    it("refuses a deactivated user with 401 ACCOUNT_DEACTIVATED", async () => {
      const attempt = auth.validateUser("off@x.com", "off-password");
      await expect(attempt).rejects.toBeInstanceOf(UnauthorizedException);
      expect(await attempt.catch(codeOf)).toBe("ACCOUNT_DEACTIVATED");
    });

    it("a wrong password is still INVALID_CREDENTIALS, deactivated or not", async () => {
      expect(await auth.validateUser("off@x.com", "nope").catch(codeOf)).toBe(
        "INVALID_CREDENTIALS",
      );
      expect(
        await auth.validateUser("active@x.com", "nope").catch(codeOf),
      ).toBe("INVALID_CREDENTIALS");
    });
  });

  describe("change-password", () => {
    it("changes the caller's own password and nobody else's", async () => {
      const otherHashBefore = users.rows.find(
        (u) => u.id === "u-other",
      )!.passwordHash;

      await auth.changePassword(
        actor("u-active"),
        "old-password",
        "new-password-1",
      );

      await expect(
        auth.validateUser("active@x.com", "new-password-1"),
      ).resolves.toMatchObject({ id: "u-active" });
      expect(
        await auth.validateUser("active@x.com", "old-password").catch(codeOf),
      ).toBe("INVALID_CREDENTIALS");
      expect(users.rows.find((u) => u.id === "u-other")!.passwordHash).toBe(
        otherHashBefore,
      );
    });

    it("400s (not 401) a wrong current password and changes nothing", async () => {
      const hashBefore = users.rows.find(
        (u) => u.id === "u-active",
      )!.passwordHash;
      const attempt = auth.changePassword(
        actor("u-active"),
        "not-my-password",
        "new-password-1",
      );
      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      expect(await attempt.catch(codeOf)).toBe("WRONG_CURRENT_PASSWORD");
      expect(users.rows.find((u) => u.id === "u-active")!.passwordHash).toBe(
        hashBefore,
      );
    });

    it("can't be used on another account: another user's current password doesn't help", async () => {
      // u-active knows u-other's password, but the endpoint only ever
      // targets the caller (actor.id) — it checks against u-active's hash.
      expect(
        await auth
          .changePassword(actor("u-active"), "other-password", "hijack-123")
          .catch(codeOf),
      ).toBe("WRONG_CURRENT_PASSWORD");
      await expect(
        auth.validateUser("other@x.com", "other-password"),
      ).resolves.toMatchObject({ id: "u-other" });
    });
  });

  describe("JWT validation", () => {
    const payload = (sub: string) => ({
      sub,
      email: "x@x.com",
      role: Role.CLIENT,
      customerId: "cust-1",
    });

    it("accepts an active user's token", async () => {
      await expect(
        strategy.validate(payload("u-active")),
      ).resolves.toMatchObject({
        id: "u-active",
      });
    });

    it("rejects a still-valid token once the user is deactivated", async () => {
      await strategy.validate(payload("u-active")); // cached as active
      await usersService.setActive("u-active", false, actor("u-other"));

      const attempt = strategy.validate(payload("u-active"));
      await expect(attempt).rejects.toBeInstanceOf(UnauthorizedException);
      expect(await attempt.catch(codeOf)).toBe("ACCOUNT_DEACTIVATED");
    });

    it("rejects a token of a user that no longer exists", async () => {
      await expect(strategy.validate(payload("ghost"))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
