import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/auth/current-user.decorator";
import { RequestUser } from "../common/auth/request-user.interface";
import { Roles } from "../common/auth/roles.decorator";
import { MAX_FILE_SIZE_BYTES } from "../common/constants/file-upload";
import { Role } from "../common/enums/role.enum";
import { ActualContainersService } from "./actual-containers.service";
import { AddContainerFileDto } from "./dto/add-container-file.dto";
import { UpdateContainerDatesDto } from "./dto/update-container-dates.dto";

/**
 * Not @ScopeByCustomer'd: the service scopes client to their own customer
 * (404 for a foreign id). GETs are open to both roles; every write is
 * @Roles(Role.OPS) — which RolesGuard already turns into a 403 for client on
 * any non-GET anyway, the decorator just says so out loud.
 */
@ApiBearerAuth()
@ApiTags("actual-containers")
@Controller("actual-containers")
export class ActualContainersController {
  constructor(private readonly service: ActualContainersService) {}

  @Get()
  findAll(@CurrentUser() user: RequestUser) {
    return this.service.findAll(user);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.findOne(id, user);
  }

  @Roles(Role.OPS)
  @Patch(":id/dates")
  updateDates(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateContainerDatesDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.updateDates(id, dto, user);
  }

  @Roles(Role.OPS)
  @Post(":id/reset-dates")
  resetDates(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.resetDates(id, user);
  }

  @Roles(Role.OPS)
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
  @Post(":id/files")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_FILE_SIZE_BYTES } }),
  )
  addFile(
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: AddContainerFileDto,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) {
      throw new BadRequestException("file is required");
    }
    return this.service.addFile(id, file, dto.description, user);
  }
}

@ApiBearerAuth()
@ApiTags("actual-containers")
@Controller("actual-container-files")
export class ActualContainerFilesController {
  constructor(private readonly service: ActualContainersService) {}

  @Roles(Role.OPS)
  @HttpCode(204)
  @Delete(":id")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.service.removeFile(id);
  }

  @Get(":id/download")
  async download(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<StreamableFile> {
    const { file, stream } = await this.service.downloadFile(id, user);
    return new StreamableFile(stream, {
      type: file.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(file.originalName)}"`,
    });
  }
}
