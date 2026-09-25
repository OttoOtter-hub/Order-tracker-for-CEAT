import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminOnly } from "../common/auth/admin-only.decorator";
import { Roles } from "../common/auth/roles.decorator";
import { Role } from "../common/enums/role.enum";
import { AuditLogService } from "./audit-log.service";
import {
  AUDIT_DEFAULT_PAGE_SIZE,
  AuditLogQueryDto,
} from "./dto/audit-log-query.dto";

/** Read-only view of the action journal — ops admins only (client and non-admin ops: 403). */
@ApiBearerAuth()
@ApiTags("audit-log")
@Roles(Role.OPS)
@AdminOnly()
@Controller("audit-log")
export class AuditLogController {
  constructor(private readonly service: AuditLogService) {}

  @Get()
  find(@Query() query: AuditLogQueryDto) {
    return this.service.find({
      entityType: query.entityType,
      entityId: query.entityId,
      actorUserId: query.actorUserId,
      action: query.action,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? AUDIT_DEFAULT_PAGE_SIZE,
    });
  }
}
