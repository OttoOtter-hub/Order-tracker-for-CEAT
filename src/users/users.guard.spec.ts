import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "../common/auth/roles.guard";
import { Role } from "../common/enums/role.enum";
import { AuthController } from "../auth/auth.controller";
import { AuditLogController } from "../audit-log/audit-log.controller";
import { UsersController } from "./users.controller";

type Who = "client" | "ops" | "admin";

// The real RolesGuard against the real controllers' decorators: who may
// reach each user-management / action-log route (Phase 20a, admin level).
function contextFor(
  controller: { prototype: object },
  handlerName: string,
  method: string,
  who: Who,
): ExecutionContext {
  const handler = (controller.prototype as Record<string, unknown>)[
    handlerName
  ] as () => unknown;
  const request = {
    method,
    user: {
      id: "u-1",
      email: "u@x.com",
      role: who === "client" ? Role.CLIENT : Role.OPS,
      customerId: who === "client" ? "cust-1" : null,
      isAdmin: who === "admin",
    },
  };
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ForbiddenException);
    return ((e as ForbiddenException).getResponse() as { code: string }).code;
  }
  return undefined;
}

describe("admin-only routes (RolesGuard)", () => {
  const guard = new RolesGuard(new Reflector());

  // The five routes of the spec, plus the new set-admin one.
  const adminRoutes: [string, { prototype: object }, string, string][] = [
    ["GET /users", UsersController, "findAll", "GET"],
    ["POST /users", UsersController, "create", "POST"],
    ["PATCH /users/:id/deactivate", UsersController, "deactivate", "PATCH"],
    ["PATCH /users/:id/reactivate", UsersController, "reactivate", "PATCH"],
    ["GET /audit-log", AuditLogController, "find", "GET"],
    ["PATCH /users/:id/set-admin", UsersController, "setAdmin", "PATCH"],
  ];

  it.each(adminRoutes)(
    "%s: an ordinary ops user (isAdmin=false) gets 403 ADMIN_ONLY_ACTION",
    (_name, controller, handler, method) => {
      expect(
        codeOf(() =>
          guard.canActivate(contextFor(controller, handler, method, "ops")),
        ),
      ).toBe("ADMIN_ONLY_ACTION");
    },
  );

  it.each(adminRoutes)(
    "%s: a client still gets 403 OPS_ONLY_ACTION",
    (_name, controller, handler, method) => {
      expect(
        codeOf(() =>
          guard.canActivate(contextFor(controller, handler, method, "client")),
        ),
      ).toBe("OPS_ONLY_ACTION");
    },
  );

  it.each(adminRoutes)(
    "%s: an admin ops user is let through",
    (_name, controller, handler, method) => {
      expect(
        guard.canActivate(contextFor(controller, handler, method, "admin")),
      ).toBe(true);
    },
  );

  it("an ops user with no isAdmin at all (older fixtures) counts as not an admin", () => {
    const context = contextFor(UsersController, "findAll", "GET", "ops");
    delete (
      context.switchToHttp().getRequest() as { user: { isAdmin?: boolean } }
    ).user.isAdmin;
    expect(codeOf(() => guard.canActivate(context))).toBe("ADMIN_ONLY_ACTION");
  });

  it("ordinary ops routes stay open to every ops user", () => {
    // e.g. the ready-to-ship view — not @AdminOnly().
    expect(
      guard.canActivate(contextFor(AuthController, "me", "GET", "ops")),
    ).toBe(true);
  });

  it("POST /auth/change-password and GET /auth/me are open to everyone", () => {
    for (const who of ["client", "ops", "admin"] as Who[]) {
      expect(
        guard.canActivate(
          contextFor(AuthController, "changePassword", "POST", who),
        ),
      ).toBe(true);
      expect(
        guard.canActivate(contextFor(AuthController, "me", "GET", who)),
      ).toBe(true);
    }
  });
});
