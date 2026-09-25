import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/auth/current-user.decorator";
import { RequestUser } from "../common/auth/request-user.interface";
import { AdminOnly } from "../common/auth/admin-only.decorator";
import { Roles } from "../common/auth/roles.decorator";
import { Role } from "../common/enums/role.enum";
import { CreateUserDto } from "./dto/create-user.dto";
import { SetAdminDto } from "./dto/set-admin.dto";
import { UsersService } from "./users.service";

/**
 * User management (Phase 20a) — ops admins only, the whole controller:
 * RolesGuard answers 403 OPS_ONLY_ACTION to a client and 403
 * ADMIN_ONLY_ACTION to a non-admin ops user on every route here, GET
 * included. Users are never deleted, only deactivated.
 */
@ApiBearerAuth()
@ApiTags("users")
@Roles(Role.OPS)
@AdminOnly()
@Controller("users")
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: RequestUser) {
    return this.service.create(dto, actor);
  }

  @Patch(":id/deactivate")
  deactivate(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.service.setActive(id, false, actor);
  }

  @Patch(":id/reactivate")
  reactivate(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.service.setActive(id, true, actor);
  }

  /** Grant or revoke admin on an ops user; the last active admin can't lose it. */
  @Patch(":id/set-admin")
  setAdmin(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetAdminDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.service.setAdmin(id, dto.isAdmin, actor);
  }
}
