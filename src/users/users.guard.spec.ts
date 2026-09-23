import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "../common/auth/roles.guard";
import { Role } from "../common/enums/role.enum";
import { AuthController } from "../auth/auth.controller";
import { UsersController } from "./users.controller";

// The real RolesGuard against the real controllers' decorators: who may
// reach each Phase 20a route.
function contextFor(
  controller: { prototype: object },
  handlerName: string,
  method: string,
  role: Role,
): ExecutionContext {
  const handler = (controller.prototype as Record<string, unknown>)[
    handlerName
  ] as () => unknown;
  const request = {
    method,
    user: { id: "u-1", email: "u@x.com", role, customerId: "cust-1" },
  };
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("Phase 20a access rules (RolesGuard)", () => {
  const guard = new RolesGuard(new Reflector());

  const userRoutes: [string, string][] = [
    ["findAll", "GET"],
    ["create", "POST"],
    ["deactivate", "PATCH"],
    ["reactivate", "PATCH"],
  ];

  it.each(userRoutes)(
    "/users %s (%s) is ops-only: client gets 403 OPS_ONLY_ACTION",
    (handler, method) => {
      let error: unknown;
      try {
        guard.canActivate(
          contextFor(UsersController, handler, method, Role.CLIENT),
        );
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: "OPS_ONLY_ACTION",
      });
    },
  );

  it.each(userRoutes)("/users %s (%s) is open to ops", (handler, method) => {
    expect(
      guard.canActivate(contextFor(UsersController, handler, method, Role.OPS)),
    ).toBe(true);
  });

  it("POST /auth/change-password is open to both roles", () => {
    for (const role of [Role.CLIENT, Role.OPS]) {
      expect(
        guard.canActivate(
          contextFor(AuthController, "changePassword", "POST", role),
        ),
      ).toBe(true);
    }
  });
});
