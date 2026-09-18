import { Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/auth/current-user.decorator";
import { RequestUser } from "../common/auth/request-user.interface";
import { Roles } from "../common/auth/roles.decorator";
import { Role } from "../common/enums/role.enum";
import { ReadyToShipService } from "./ready-to-ship.service";

@ApiBearerAuth()
@ApiTags("ready-to-ship")
@Controller("containers")
export class ShippingContainersController {
  constructor(private readonly service: ReadyToShipService) {}

  /** Ops-only: @Roles(Role.OPS) makes RolesGuard 403 a client on this handler. */
  @Roles(Role.OPS)
  @Post(":id/unlock")
  unlock(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.unlock(id, user);
  }
}
