import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditLog } from "./audit-log.entity";
import { AuditLogController } from "./audit-log.controller";
import { AuditLogService } from "./audit-log.service";

/**
 * Global: almost every feature module journals its writes, so AuditLogService
 * is injectable everywhere without each of them importing this module.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
