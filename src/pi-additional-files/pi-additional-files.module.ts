import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PiAdditionalFile } from "./pi-additional-file.entity";

/**
 * Phase 1 scaffold: registers the entity only, so ProformaInvoice's
 * relation resolves. Upload/list/delete endpoints land in a later phase.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PiAdditionalFile])],
  exports: [TypeOrmModule],
})
export class PiAdditionalFilesModule {}
