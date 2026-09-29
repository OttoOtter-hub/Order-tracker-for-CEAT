import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ActualContainerLineItem } from "../actual-containers/actual-container-line-item.entity";
import { PiLineItem } from "../pi-line-items/pi-line-item.entity";
import { ProformaInvoice } from "../proforma-invoices/proforma-invoice.entity";
import { ContainerLineAllocation } from "../ready-to-ship/container-line-allocation.entity";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProformaInvoice,
      PiLineItem,
      ContainerLineAllocation,
      ActualContainerLineItem,
    ]),
  ],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
