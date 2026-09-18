import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CustomersModule } from "../customers/customers.module";
import { FilesModule } from "../files/files.module";
import { PiLineItemsModule } from "../pi-line-items/pi-line-items.module";
import { ProformaInvoicesModule } from "../proforma-invoices/proforma-invoices.module";
import { ReadyToShipModule } from "../ready-to-ship/ready-to-ship.module";
import { BackorderUpload } from "./backorder-upload.entity";
import { BackorderController } from "./backorder.controller";
import { BackorderUploadsController } from "./backorder-uploads.controller";
import { BackorderUploadsService } from "./backorder-uploads.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([BackorderUpload]),
    ProformaInvoicesModule,
    PiLineItemsModule,
    CustomersModule,
    FilesModule,
    ReadyToShipModule,
  ],
  controllers: [BackorderUploadsController, BackorderController],
  providers: [BackorderUploadsService],
  exports: [TypeOrmModule],
})
export class BackorderUploadsModule {}
