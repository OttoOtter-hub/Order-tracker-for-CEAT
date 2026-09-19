import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { Roles } from "../common/auth/roles.decorator";
import { Role } from "../common/enums/role.enum";
import { CurrentUser } from "../common/auth/current-user.decorator";
import { RequestUser } from "../common/auth/request-user.interface";
import { MAX_FILE_SIZE_BYTES } from "../common/constants/file-upload";
import { BackorderUploadsService } from "./backorder-uploads.service";
import { BackorderUploadResultDto } from "./dto/backorder-upload-result.dto";

/**
 * Ops-only end to end (@Roles(Role.OPS) — this is internal factory
 * planning data, not something a client role has any reason to see or
 * upload, matching the precedent set by PiSoAllocation/ContainerLoadItem
 * in v1).
 */
@ApiBearerAuth()
@ApiTags("backorder-uploads")
@Roles(Role.OPS)
@Controller("backorder-uploads")
export class BackorderUploadsController {
  constructor(private readonly service: BackorderUploadsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(":id/snapshot-export")
  async exportSnapshot(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const { buffer, fileName } = await this.service.exportSnapshot(id);
    return new StreamableFile(buffer, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      disposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
    });
  }

  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  @ApiOkResponse({ type: BackorderUploadResultDto })
  @Post()
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_FILE_SIZE_BYTES } }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) {
      throw new BadRequestException("file is required");
    }
    return this.service.upload(file, user);
  }
}
