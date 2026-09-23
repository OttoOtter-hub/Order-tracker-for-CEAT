import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { RequestUser } from "../common/auth/request-user.interface";
import { apiError } from "../common/errors/api-error";
import { PASSWORD_HASH_ROUNDS, UsersService } from "../users/users.service";
import { User } from "../users/user.entity";

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException(
        apiError("INVALID_CREDENTIALS", "Invalid credentials"),
      );
    }
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException(
        apiError("INVALID_CREDENTIALS", "Invalid credentials"),
      );
    }
    // Only after the password matched, so the answer can't be used to probe
    // which emails exist.
    if (!user.isActive) {
      throw new UnauthorizedException(
        apiError("ACCOUNT_DEACTIVATED", "This account has been deactivated"),
      );
    }
    return user;
  }

  login(user: User): { accessToken: string } {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      customerId: user.customer?.id ?? null,
    };
    return { accessToken: this.jwtService.sign(payload) };
  }

  /**
   * Any logged-in user changes their own password — always the token's own
   * user, there is no user id to pass. A wrong current password is a 400,
   * not a 401: the frontend treats 401 as "session over" and would log the
   * user out.
   */
  async changePassword(
    actor: RequestUser,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.usersService.findById(actor.id);
    if (!user) {
      throw new NotFoundException(
        apiError("NOT_FOUND", `User ${actor.id} not found`),
      );
    }
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new BadRequestException(
        apiError("WRONG_CURRENT_PASSWORD", "current password is incorrect"),
      );
    }
    await this.usersService.setPasswordHash(
      user.id,
      await bcrypt.hash(newPassword, PASSWORD_HASH_ROUNDS),
    );
  }
}
