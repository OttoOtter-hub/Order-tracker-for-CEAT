import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Reflector } from "@nestjs/core";
import { apiError } from "../errors/api-error";
import { IS_PUBLIC_KEY } from "./public.decorator";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  // Same as passport's default (rethrow, or 401 when there's no user) — only
  // the missing/expired/invalid-token 401 now carries an error code.
  handleRequest<TUser>(err: unknown, user: TUser | false): TUser {
    if (err) {
      throw err;
    }
    if (!user) {
      throw new UnauthorizedException(apiError("UNAUTHORIZED", "Unauthorized"));
    }
    return user;
  }
}
