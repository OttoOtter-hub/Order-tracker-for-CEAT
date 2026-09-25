import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "../enums/role.enum";
import { apiError } from "../errors/api-error";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { ROLES_KEY } from "./roles.decorator";
import { ADMIN_ONLY_KEY } from "./admin-only.decorator";
import { CLIENT_WRITE_ALLOWED_KEY } from "./client-write-allowed.decorator";
import { RequestUser } from "./request-user.interface";

/**
 * Single authorization gate, applied globally, so no controller method has to
 * repeat "if role === client, only allow GET / only my customer" by hand:
 * - ops: always allowed — except on @AdminOnly() controllers/handlers, which
 *   need an ops admin (User.isAdmin); anyone else there gets 403
 *   ADMIN_ONLY_ACTION.
 * - client: 403 on controllers marked @Roles(Role.OPS); 403 on any non-GET
 *   method unless the handler is @ClientWriteAllowed(); otherwise allowed
 *   (row-level scoping to the client's own customer_id happens afterwards,
 *   in CustomerScopeInterceptor).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: RequestUser | undefined = request.user;
    if (!user) {
      throw new UnauthorizedException(apiError("UNAUTHORIZED", "Unauthorized"));
    }
    if (user.role === Role.OPS) {
      const adminOnly = this.reflector.getAllAndOverride<boolean>(
        ADMIN_ONLY_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (adminOnly && !user.isAdmin) {
        throw new ForbiddenException(
          apiError(
            "ADMIN_ONLY_ACTION",
            "This resource is only available to CEAT administrators",
          ),
        );
      }
      return true;
    }

    const allowedRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowedRoles && !allowedRoles.includes(Role.CLIENT)) {
      throw new ForbiddenException(
        apiError(
          "OPS_ONLY_ACTION",
          "This resource is only available to CEAT ops users",
        ),
      );
    }

    if (request.method !== "GET") {
      const writeAllowed = this.reflector.getAllAndOverride<boolean>(
        CLIENT_WRITE_ALLOWED_KEY,
        [context.getHandler()],
      );
      if (!writeAllowed) {
        throw new ForbiddenException(
          apiError("CLIENT_READ_ONLY", "Client users have read-only access"),
        );
      }
    }

    return true;
  }
}
