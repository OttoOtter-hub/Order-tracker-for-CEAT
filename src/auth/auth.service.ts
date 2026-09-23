import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { apiError } from "../common/errors/api-error";
import { UsersService } from "../users/users.service";
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
}
