import { Controller, Get, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/auth/current-user.decorator";
import { RequestUser } from "../common/auth/request-user.interface";
import { BackorderUploadsService } from "./backorder-uploads.service";

/**
 * Separate controller (distinct base path `/backorder`, not
 * `/backorder-uploads`) but backed by the same service/module — this is a
 * *view* over the current backorder state (active cards' line items),
 * not another action on the upload audit trail itself. No `@Roles(Role.OPS)`
 * here (unlike `/backorder-uploads`, which stays ops-only) — client is
 * allowed too, scoped to their own customer_id in the service.
 */
@ApiBearerAuth()
@ApiTags("backorder")
@Controller("backorder")
export class BackorderController {
  constructor(private readonly service: BackorderUploadsService) {}

  @Get("export-xlsx")
  async exportXlsx(@CurrentUser() user: RequestUser): Promise<StreamableFile> {
    const { buffer, fileName } = await this.service.exportXlsx(user);
    return new StreamableFile(buffer, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      disposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
    });
  }
}
