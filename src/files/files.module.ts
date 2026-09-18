import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PiAdditionalFile } from "../pi-additional-files/pi-additional-file.entity";
import { ProformaInvoice } from "../proforma-invoices/proforma-invoice.entity";
import { StoredFile } from "./stored-file.entity";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([StoredFile, ProformaInvoice, PiAdditionalFile]),
  ],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
