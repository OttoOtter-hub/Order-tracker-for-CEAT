import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { RequestUser } from "../common/auth/request-user.interface";
import { apiError } from "../common/errors/api-error";
import { UsersService } from "../users/users.service";

interface JwtPayload {
  sub: string;
  email: string;
  role: RequestUser["role"];
  customerId: string | null;
  /** UI hint only — authorization uses the database value below. */
  isAdmin?: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>("JWT_SECRET", "dev-secret-change-me"),
    });
  }

  /**
   * A still-valid token of a user who has since been deactivated stops
   * working right away, not when it expires (JWT_EXPIRES_IN, 8h by default)
   * — the status is cached, so this is not a query per request. isAdmin comes
   * from the same lookup, not from the token: granting or revoking it
   * applies without a new login.
   */
  async validate(payload: JwtPayload): Promise<RequestUser> {
    const status = await this.usersService.getAuthStatus(payload.sub);
    if (!status.active) {
      throw new UnauthorizedException(
        apiError("ACCOUNT_DEACTIVATED", "This account has been deactivated"),
      );
    }
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      customerId: payload.customerId,
      isAdmin: status.isAdmin,
    };
  }
}
