import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ClientWriteAllowed } from "../common/auth/client-write-allowed.decorator";
import { CurrentUser } from "../common/auth/current-user.decorator";
import { Public } from "../common/auth/public.decorator";
import { RequestUser } from "../common/auth/request-user.interface";
import { AuthService } from "./auth.service";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LoginDto } from "./dto/login.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post("login")
  async login(@Body() dto: LoginDto) {
    const user = await this.authService.validateUser(dto.email, dto.password);
    return this.authService.login(user);
  }

  /**
   * Who the token's user is right now — isAdmin straight from the database
   * (via JwtStrategy), so the frontend's menu follows a grant/revoke without
   * a new login.
   */
  @ApiBearerAuth()
  @Get("me")
  me(@CurrentUser() user: RequestUser) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      customerId: user.customerId,
      isAdmin: !!user.isAdmin,
    };
  }

  /** Both roles, always the caller's own password (Phase 20a). */
  @ApiBearerAuth()
  @ClientWriteAllowed()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post("change-password")
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    await this.authService.changePassword(
      user,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
