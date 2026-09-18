import {
  Controller,
  Get,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../common/auth/current-user.decorator";
import { RequestUser } from "../common/auth/request-user.interface";
import { MAX_FILE_SIZE_BYTES } from "../common/constants/file-upload";
import { FilesService } from "./files.service";
import { UploadFileResponseDto } from "./dto/upload-file-response.dto";

@ApiBearerAuth()
@ApiTags("files")
@Controller("files")
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  /**
   * ops-only (non-GET, not @ClientWriteAllowed()). Generic upload — nothing
   * in the app currently calls this over HTTP; ProformaInvoicesService
   * calls FilesService.save() directly in-process instead, since its
   * upload endpoints need to do more than just store bytes in the same
   * request (resolve/create the PI card, dedupe, etc). Kept as a
   * standalone endpoint for future callers that just need "store a file,
   * get back a URL" with no PI involved.
   */
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  @ApiOkResponse({ type: UploadFileResponseDto })
  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_FILE_SIZE_BYTES } }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: RequestUser,
  ): Promise<UploadFileResponseDto> {
    const stored = await this.filesService.save(file, user.id);
    return {
      id: stored.id,
      url: `/files/${stored.id}/download`,
      originalName: stored.originalName,
      mimeType: stored.mimeType,
    };
  }

  /**
   * Any authenticated user — ops always allowed; client is restricted to
   * files actually referenced by one of their own PIs (see
   * FilesService.assertClientCanAccess), added in Phase 2 once client
   * uploads (signed PI, additional files) made this reachable for
   * genuinely cross-customer content for the first time.
   */
  @Get(":id/download")
  async download(
    @Param("id") id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<StreamableFile> {
    const { file, stream } = await this.filesService.getDownloadable(
      id,
      user,
    );
    return new StreamableFile(stream, {
      type: file.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(file.originalName)}"`,
    });
  }
}
