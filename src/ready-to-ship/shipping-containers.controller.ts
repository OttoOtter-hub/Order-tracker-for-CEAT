import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ClientWriteAllowed } from "../common/auth/client-write-allowed.decorator";
import { CurrentUser } from "../common/auth/current-user.decorator";
import { RequestUser } from "../common/auth/request-user.interface";
import { Roles } from "../common/auth/roles.decorator";
import { Role } from "../common/enums/role.enum";
import { UpdateContainerNameDto } from "./dto/update-container-name.dto";
import { ReadyToShipService } from "./ready-to-ship.service";
import { MarkingFilesService } from "./marking-files.service";
import { createZipStream } from "./utils/marking-zip";
import { attachmentDisposition } from "../common/utils/content-disposition";

@ApiBearerAuth()
@ApiTags("ready-to-ship")
@Controller("containers")
export class ShippingContainersController {
  private readonly logger = new Logger(ShippingContainersController.name);

  constructor(
    private readonly service: ReadyToShipService,
    private readonly markingFiles: MarkingFilesService,
  ) {}

  /**
   * Phase 24: every marking file of the container in one ZIP, streamed as
   * it is built. Both roles (a client only for their own container). All
   * checks happen before the first byte is sent, so a refusal is an
   * ordinary JSON error.
   */
  @Get(":id/marking-zip")
  async markingZip(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<StreamableFile> {
    const { fileName, entries } =
      await this.markingFiles.prepareContainerArchive(id, user);
    const zip = createZipStream(entries, (warning) =>
      this.logger.warn(`marking ZIP ${id}: ${warning.message}`),
    );
    return new StreamableFile(zip, {
      type: "application/zip",
      disposition: attachmentDisposition(fileName),
    });
  }

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
   * Phase 22: a name for a numbered container; answers with the fresh
   * ready-to-ship view. Phase 25: whoever edits the load list now.
   */
  @ClientWriteAllowed()
  @Patch(":id/name")
  rename(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateContainerNameDto,
    @CurrentUser() user: RequestUser,
    @Query("customerId", new ParseUUIDPipe({ optional: true }))
    customerId?: string,
  ) {
    return this.service.rename(id, dto.name, user, customerId);
  }

  /**
   * Phase 23: every position of one container back to the unallocated list
   * at once (the container itself stays). Phase 25: whoever edits the load
   * list now.
   */
  @ClientWriteAllowed()
  @Post(":id/clear")
  clear(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Query("customerId", new ParseUUIDPipe({ optional: true }))
    customerId?: string,
  ) {
    return this.service.clearContainer(id, user, customerId);
  }
}
