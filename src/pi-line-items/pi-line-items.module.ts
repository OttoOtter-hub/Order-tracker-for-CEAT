import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PiLineItem } from "./pi-line-item.entity";
import { PiLineItemsController } from "./pi-line-items.controller";
import { PiLineItemsService } from "./pi-line-items.service";

/**
 * Phase 1 scaffold registered the entity only, read as a relation off
 * ProformaInvoice. This phase (client priority) adds the first dedicated
 * write endpoint — PATCH /pi-line-items/:id/priority.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PiLineItem])],
  controllers: [PiLineItemsController],
  providers: [PiLineItemsService],
  exports: [TypeOrmModule],
})
export class PiLineItemsModule {}
