import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { ClientWriteAllowed } from "../common/auth/client-write-allowed.decorator";
import { CurrentUser } from "../common/auth/current-user.decorator";
import { RequestUser } from "../common/auth/request-user.interface";
import { MAX_FILE_SIZE_BYTES } from "../common/constants/file-upload";
import { MarkingFilesService } from "./marking-files.service";

/**
 * Not @ScopeByCustomer'd — responses here are a small ack object or a file
 * stream; ownership (allocation -> container -> customer) is checked in the
 * service, same as the other client-facing writes.
 */
@ApiBearerAuth()
@ApiTags("ready-to-ship")
@Controller("container-allocations")
export class ContainerAllocationsController {
  constructor(private readonly markingFiles: MarkingFilesService) {}

  @ClientWriteAllowed()
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  @Post(":id/marking-file")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_FILE_SIZE_BYTES } }),
  )
  upload(
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) {
      throw new BadRequestException("file is required");
    }
    return this.markingFiles.upload(id, file, user);
  }

  @ClientWriteAllowed()
  @HttpCode(204)
  @Delete(":id/marking-file")
  async remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    await this.markingFiles.remove(id, user);
  }

  @Get(":id/marking-file/download")
  async download(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<StreamableFile> {
    const { file, stream } = await this.markingFiles.download(id, user);
    return new StreamableFile(stream, {
      type: file.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(file.originalName)}"`,
    });
  }
}
