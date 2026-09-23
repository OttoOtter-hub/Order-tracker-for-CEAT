import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ActualContainerLineItem } from "../actual-containers/actual-container-line-item.entity";
import { ContainerLineAllocation } from "../ready-to-ship/container-line-allocation.entity";
import { CustomersModule } from "../customers/customers.module";
import { FilesModule } from "../files/files.module";
import { PiAdditionalFilesModule } from "../pi-additional-files/pi-additional-files.module";
import { PiLineItemsModule } from "../pi-line-items/pi-line-items.module";
import { ProformaInvoice } from "./proforma-invoice.entity";
import { PiFileVersion } from "./pi-file-version.entity";
import { ProformaInvoicesController } from "./proforma-invoices.controller";
import { ProformaInvoicesService } from "./proforma-invoices.service";

@Module({
  imports: [
    // ContainerLineAllocation/ActualContainerLineItem are ready-to-ship's and
    // actual-containers' own entities — registered here too (rather than
    // importing those modules, neither of which exports TypeOrmModule) purely
    // for the read-only repos Phase 12's reconciliation needs; TypeORM allows
    // the same entity to be registered in more than one module's forFeature.
    TypeOrmModule.forFeature([
      ProformaInvoice,
      PiFileVersion,
      ContainerLineAllocation,
      ActualContainerLineItem,
    ]),
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
