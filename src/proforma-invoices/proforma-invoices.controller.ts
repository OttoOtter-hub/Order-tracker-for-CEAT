import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { ScopeByCustomer } from "../common/auth/scope-by-customer.decorator";
import { ClientWriteAllowed } from "../common/auth/client-write-allowed.decorator";
import { CurrentUser } from "../common/auth/current-user.decorator";
import { RequestUser } from "../common/auth/request-user.interface";
import { MAX_FILE_SIZE_BYTES } from "../common/constants/file-upload";
import { apiError } from "../common/errors/api-error";
import { ProformaInvoicesService } from "./proforma-invoices.service";
import { AddAdditionalFileDto } from "./dto/add-additional-file.dto";
import { ReplacementDecisionDto } from "./dto/replacement-decision.dto";
import { UpdateLabelDto } from "./dto/update-label.dto";

const FILE_UPLOAD_OPTIONS = { limits: { fileSize: MAX_FILE_SIZE_BYTES } };
const FILE_UPLOAD_BODY_SCHEMA = {
  schema: {
    type: "object",
    properties: { file: { type: "string", format: "binary" } },
  },
};

function requireFile(
  file: Express.Multer.File | undefined,
): Express.Multer.File {
  if (!file) {
    throw new BadRequestException(
      apiError("FILE_REQUIRED", "file is required"),
    );
  }
  return file;
}

/**
 * Phase 2 adds real writes on top of Phase 1's read-only scaffold: upload
 * the original PI (ops), upload the signed copy (client), attach free-form
 * files (either role), and the propose/decide replacement flow for
 * swapping the original document after the fact. Ops sees every card
 * unscoped; client is restricted to their own customer_id by
 * CustomerScopeInterceptor for the two GETs below (@ScopeByCustomer,
 * declared per-method rather than on the class — see note on
 * addAdditionalFile) and by an explicit ownership check in the service for
 * writes (see ProformaInvoicesService.findOwnedByActor).
 */
@ApiBearerAuth()
@ApiTags("proforma-invoices")
@Controller("proforma-invoices")
export class ProformaInvoicesController {
  constructor(private readonly service: ProformaInvoicesService) {}

  @ScopeByCustomer("customer.id")
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @ScopeByCustomer("customer.id")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  /**
   * Not @ScopeByCustomer'd, same reasoning as addAdditionalFile below —
   * this returns a binary xlsx, not a ProformaInvoice, so the interceptor
   * has nothing to scope. Ownership is checked in the service.
   */
  @Get(":id/export-xlsx")
  async exportXlsx(
    @Param("id") id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<StreamableFile> {
    const { buffer, fileName } = await this.service.exportXlsx(id, user);
    return new StreamableFile(buffer, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      disposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
    });
  }

  /**
   * Phase 19: every version of the original and signed files, newest first,
   * the current ones marked (replacedAt null). Read-only, both roles; not
   * @ScopeByCustomer'd — it returns a list of versions, not a
   * ProformaInvoice — so the owner-check is in the service (404 for a client
   * on someone else's card).
   */
  @Get(":id/file-history")
  getFileHistory(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.service.getFileHistory(id, user);
  }

  /**
   * Ops-only: no @ClientWriteAllowed(), so RolesGuard already 403s client
   * on this POST. PI number comes from the filename, not a form field.
   */
  @ApiConsumes("multipart/form-data")
  @ApiBody(FILE_UPLOAD_BODY_SCHEMA)
  @Post("upload-pi")
  @UseInterceptors(FileInterceptor("file", FILE_UPLOAD_OPTIONS))
  uploadPi(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.uploadPi(requireFile(file), user);
  }

  @ClientWriteAllowed()
  @ApiConsumes("multipart/form-data")
  @ApiBody(FILE_UPLOAD_BODY_SCHEMA)
  @Post(":id/upload-signed")
  @UseInterceptors(FileInterceptor("file", FILE_UPLOAD_OPTIONS))
  uploadSigned(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.uploadSigned(id, requireFile(file), user);
  }

  /**
   * Deliberately not @ScopeByCustomer'd (unlike the class used to be as a
   * whole): this returns a PiAdditionalFile, not a ProformaInvoice, so
   * CustomerScopeInterceptor's 'customer.id' path wouldn't resolve against
   * it at all — it lives at pi.customer.id here — and would 404 every
   * client response even on a fully authorized request. Ownership is
   * already enforced in the service (findOwnedByActor) before anything is
   * written, same as every other client-facing write on this controller.
   */
  @ClientWriteAllowed()
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: { type: "string", format: "binary" },
        description: { type: "string" },
      },
    },
  })
  @Post(":id/additional-files")
  @UseInterceptors(FileInterceptor("file", FILE_UPLOAD_OPTIONS))
  addAdditionalFile(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: AddAdditionalFileDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.addAdditionalFile(
      id,
      requireFile(file),
      dto.description,
      user,
    );
  }

  /**
   * Ops-only, same implicit RolesGuard rule as upload-pi.
   */
  @ApiConsumes("multipart/form-data")
  @ApiBody(FILE_UPLOAD_BODY_SCHEMA)
  @Post(":id/propose-replacement")
  @UseInterceptors(FileInterceptor("file", FILE_UPLOAD_OPTIONS))
  proposeReplacement(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.proposeReplacement(id, requireFile(file), user);
  }

  @ClientWriteAllowed()
  @Post(":id/replacement-decision")
  replacementDecision(
    @Param("id") id: string,
    @Body() dto: ReplacementDecisionDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.replacementDecision(id, dto.approved, user);
  }

  /**
   * Client names the card, once signed it is locked for good (400). Ops
   * reaches the handler through "ops always allowed" and is rejected with a
   * 403 in the service.
   */
  @ClientWriteAllowed()
  @Patch(":id/label")
  updateLabel(
    @Param("id") id: string,
    @Body() dto: UpdateLabelDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.updateLabel(id, dto.label, user);
  }

  /**
   * @ClientWriteAllowed() gets a client actor past RolesGuard for this
   * non-GET method; ops also reaches the handler ("ops always allowed") but
   * ProformaInvoicesService.resetPriority explicitly rejects any non-client
   * actor — see that method's doc comment.
   */
  @ClientWriteAllowed()
  @Patch(":id/reset-priority")
  resetPriority(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.service.resetPriority(id, user);
  }
}
