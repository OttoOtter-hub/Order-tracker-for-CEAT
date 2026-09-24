import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ClientWriteAllowed } from "../common/auth/client-write-allowed.decorator";
import { CurrentUser } from "../common/auth/current-user.decorator";
import { RequestUser } from "../common/auth/request-user.interface";
import { Roles } from "../common/auth/roles.decorator";
import { Role } from "../common/enums/role.enum";
import { UpdateContainerNameDto } from "./dto/update-container-name.dto";
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

  /**
   * Phase 22: the client names its own numbered container; answers with the
   * fresh ready-to-ship view. Ops reaches the handler ("ops always allowed")
   * and is rejected with a 403 in the service.
   */
  @ClientWriteAllowed()
  @Patch(":id/name")
  rename(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateContainerNameDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.rename(id, dto.name, user);
  }
}
