import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CustomersModule } from "../customers/customers.module";
import { FilesModule } from "../files/files.module";
import { PiAdditionalFilesModule } from "../pi-additional-files/pi-additional-files.module";
import { PiLineItemsModule } from "../pi-line-items/pi-line-items.module";
import { ProformaInvoice } from "./proforma-invoice.entity";
import { ProformaInvoicesController } from "./proforma-invoices.controller";
import { ProformaInvoicesService } from "./proforma-invoices.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([ProformaInvoice]),
    PiAdditionalFilesModule,
    // For resetPriority's PiLineItem repo — same "import the owning
    // feature module for its TypeOrmModule export" pattern already used by
    // BackorderUploadsModule to reach both ProformaInvoice and PiLineItem.
    PiLineItemsModule,
    FilesModule,
    CustomersModule,
  ],
  controllers: [ProformaInvoicesController],
  providers: [ProformaInvoicesService],
  exports: [TypeOrmModule],
})
export class ProformaInvoicesModule {}
