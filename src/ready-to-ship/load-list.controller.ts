import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ParseUUIDPipe } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { ClientWriteAllowed } from "../common/auth/client-write-allowed.decorator";
import { CurrentUser } from "../common/auth/current-user.decorator";
import { RequestUser } from "../common/auth/request-user.interface";
import { MAX_FILE_SIZE_BYTES } from "../common/constants/file-upload";
import { apiError } from "../common/errors/api-error";
import { attachmentDisposition } from "../common/utils/content-disposition";
import { RejectLoadListDto } from "./dto/reject-load-list.dto";
import { LoadListService } from "./load-list.service";

/**
 * Phase 25: the load list's status changes, the client-version screen and
 * the Excel upload. Who may do what (and in which status) is checked in
 * LoadListService; every POST is @ClientWriteAllowed() to get a client
 * past RolesGuard. Ops names the customer with ?customerId=.
 */
@ApiBearerAuth()
@ApiTags("ready-to-ship")
@ApiQuery({ name: "customerId", required: false, description: "ops: required" })
@Controller("ready-to-ship/load-list")
export class LoadListController {
  constructor(private readonly loadLists: LoadListService) {}

  /** CEAT: draft_ceat -> sent_to_client. */
  @ClientWriteAllowed()
  @Post("send")
  send(
    @CurrentUser() user: RequestUser,
    @Query("customerId", new ParseUUIDPipe({ optional: true }))
    customerId?: string,
  ) {
    return this.loadLists.send(user, customerId);
  }

  /** Client: sent_to_client -> confirmed. */
  @ClientWriteAllowed()
  @Post("accept")
  accept(
    @CurrentUser() user: RequestUser,
    @Query("customerId", new ParseUUIDPipe({ optional: true }))
    customerId?: string,
  ) {
    return this.loadLists.accept(user, customerId);
  }

  /** Client: sent_to_client -> client_editing. */
  @ClientWriteAllowed()
  @Post("request-edit")
  requestEdit(
    @CurrentUser() user: RequestUser,
    @Query("customerId", new ParseUUIDPipe({ optional: true }))
    customerId?: string,
  ) {
    return this.loadLists.requestEdit(user, customerId);
  }

  /** Client: client_editing -> submitted_by_client. */
  @ClientWriteAllowed()
  @Post("submit")
  submit(
    @CurrentUser() user: RequestUser,
    @Query("customerId", new ParseUUIDPipe({ optional: true }))
    customerId?: string,
  ) {
    return this.loadLists.submit(user, customerId);
  }

  /** CEAT: submitted_by_client -> confirmed (re-checked against the current backorder). */
  @ClientWriteAllowed()
  @Post("approve")
  approve(
    @CurrentUser() user: RequestUser,
    @Query("customerId", new ParseUUIDPipe({ optional: true }))
    customerId?: string,
  ) {
    return this.loadLists.approve(user, customerId);
  }

  /** CEAT: submitted_by_client -> sent_to_client, back to CEAT's version; comment required. */
  @ClientWriteAllowed()
  @Post("reject")
  reject(
    @Body() dto: RejectLoadListDto,
    @CurrentUser() user: RequestUser,
    @Query("customerId", new ParseUUIDPipe({ optional: true }))
    customerId?: string,
  ) {
    return this.loadLists.reject(user, dto.comment, customerId);
  }

  /** CEAT: confirmed -> draft_ceat ("Edit load list"). */
  @ClientWriteAllowed()
  @Post("reopen")
  reopen(
    @CurrentUser() user: RequestUser,
    @Query("customerId", new ParseUUIDPipe({ optional: true }))
    customerId?: string,
  ) {
    return this.loadLists.reopen(user, customerId);
  }

  /** CEAT's version against the client's. */
  @Get("diff")
  diff(
    @CurrentUser() user: RequestUser,
    @Query("customerId", new ParseUUIDPipe({ optional: true }))
    customerId?: string,
  ) {
    return this.loadLists.diff(user, customerId);
  }

  /** The client's version as the usual load-list sheet. */
  @Get("client-version.xlsx")
  async clientVersionXlsx(
    @CurrentUser() user: RequestUser,
    @Query("customerId", new ParseUUIDPipe({ optional: true }))
    customerId?: string,
  ): Promise<StreamableFile> {
    const { buffer, fileName } = await this.loadLists.clientVersionXlsx(
      user,
      customerId,
    );
    return new StreamableFile(buffer, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      disposition: attachmentDisposition(fileName),
    });
  }

  /**
   * Excel upload (the export's own format): ops in draft_ceat, the client in
   * client_editing. ?confirmNewContainers=true creates the numbered
   * containers the file names that don't exist yet (ops only; without it
   * such a file is answered with the list, unapplied).
   */
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  @ClientWriteAllowed()
  @Post("import-xlsx")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_FILE_SIZE_BYTES } }),
  )
  importXlsx(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
    @Query("customerId", new ParseUUIDPipe({ optional: true }))
    customerId?: string,
    @Query("confirmNewContainers") confirmNewContainers?: string,
  ) {
    if (!file) {
      throw new BadRequestException(
        apiError("FILE_REQUIRED", "file is required"),
      );
    }
    return this.loadLists.importXlsx(
      user,
      file,
      confirmNewContainers === "true",
      customerId,
    );
  }
}
