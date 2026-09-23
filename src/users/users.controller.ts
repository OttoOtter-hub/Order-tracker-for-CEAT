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
import { Roles } from "../common/auth/roles.decorator";
import { Role } from "../common/enums/role.enum";
import { CreateUserDto } from "./dto/create-user.dto";
import { UsersService } from "./users.service";

/**
 * User management (Phase 20a) — ops only, the whole controller: RolesGuard
 * answers 403 OPS_ONLY_ACTION to a client on every route here, GET included.
 * Users are never deleted, only deactivated.
 */
@ApiBearerAuth()
@ApiTags("users")
@Roles(Role.OPS)
@Controller("users")
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.service.create(dto);
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
}
