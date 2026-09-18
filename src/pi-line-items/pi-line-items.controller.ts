import { Body, Controller, Param, Patch } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ClientWriteAllowed } from "../common/auth/client-write-allowed.decorator";
import { CurrentUser } from "../common/auth/current-user.decorator";
import { RequestUser } from "../common/auth/request-user.interface";
import { UpdatePriorityDto } from "./dto/update-priority.dto";
import { PiLineItemsService } from "./pi-line-items.service";

/**
 * @ClientWriteAllowed() lets a client actor past RolesGuard for this
 * non-GET method; ops also reaches the handler (RolesGuard's "ops always
 * allowed" rule) but PiLineItemsService.updatePriority explicitly rejects
 * any non-client actor — see that method's doc comment for why this can't
 * just be an ops-blocking @Roles() decorator.
 */
@ApiBearerAuth()
@ApiTags("pi-line-items")
@Controller("pi-line-items")
export class PiLineItemsController {
  constructor(private readonly service: PiLineItemsService) {}

  @ClientWriteAllowed()
  @Patch(":id/priority")
  updatePriority(
    @Param("id") id: string,
    @Body() dto: UpdatePriorityDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.updatePriority(id, dto.priorityQty, user);
  }
}
