import {
  Body,
  Controller,
  Get,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from "@nestjs/common";
import { ApiBearerAuth, ApiQuery, ApiTags } from "@nestjs/swagger";
import { ClientWriteAllowed } from "../common/auth/client-write-allowed.decorator";
import { CurrentUser } from "../common/auth/current-user.decorator";
import { RequestUser } from "../common/auth/request-user.interface";
import { MoveAllocationDto } from "./dto/move-allocation.dto";
import { RemoveAllocationDto } from "./dto/remove-allocation.dto";
import { ReadyToShipService } from "./ready-to-ship.service";

/**
 * Not @ScopeByCustomer'd: responses are a composed view, not a single
 * customer-owned entity, so the interceptor has no path to check. Scoping
 * is done in the service (client -> own customer_id; ops must name one).
 *
 * Every POST here is @ClientWriteAllowed() to get a client past
 * RolesGuard's read-only rule; ops also reaches the handlers ("ops always
 * allowed") and is rejected explicitly in ReadyToShipService.
 */
@ApiBearerAuth()
@ApiTags("ready-to-ship")
@Controller("ready-to-ship")
export class ReadyToShipController {
  constructor(private readonly service: ReadyToShipService) {}

  @ApiQuery({
    name: "customerId",
    required: false,
    description:
      "ops only (required for ops); ignored/checked against own customer for client",
  })
  @Get()
  view(
    @CurrentUser() user: RequestUser,
    @Query("customerId", new ParseUUIDPipe({ optional: true }))
    customerId?: string,
  ) {
    return this.service.getView(user, customerId);
  }

  @ApiQuery({
    name: "customerId",
    required: false,
    description:
      "ops only (required for ops); the client always gets their own",
  })
  @Get("export-xlsx")
  async exportXlsx(
    @CurrentUser() user: RequestUser,
    @Query("customerId", new ParseUUIDPipe({ optional: true }))
    customerId?: string,
  ): Promise<StreamableFile> {
    const { buffer, fileName } = await this.service.exportXlsx(
      user,
      customerId,
    );
    return new StreamableFile(buffer, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      disposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
    });
  }

  @ClientWriteAllowed()
  @Post("move")
  move(@Body() dto: MoveAllocationDto, @CurrentUser() user: RequestUser) {
    return this.service.move(dto, user);
  }

  @ClientWriteAllowed()
  @Post("remove")
  remove(@Body() dto: RemoveAllocationDto, @CurrentUser() user: RequestUser) {
    return this.service.remove(dto, user);
  }

  @ClientWriteAllowed()
  @Post("undo-last")
  undoLast(@CurrentUser() user: RequestUser) {
    return this.service.undoLast(user);
  }

  @ClientWriteAllowed()
  @Post("undo-all")
  undoAll(@CurrentUser() user: RequestUser) {
    return this.service.undoAll(user);
  }

  @ClientWriteAllowed()
  @Post("confirm")
  confirm(@CurrentUser() user: RequestUser) {
    return this.service.confirm(user);
  }
}
