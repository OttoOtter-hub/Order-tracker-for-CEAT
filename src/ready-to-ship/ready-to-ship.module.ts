import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FilesModule } from "../files/files.module";
import { AllocationAction } from "./allocation-action.entity";
import { AllocationRelinkService } from "./allocation-relink.service";
import { ContainerAllocationsController } from "./container-allocations.controller";
import { ContainerLineAllocation } from "./container-line-allocation.entity";
import { LoadList } from "./load-list.entity";
import { MarkingFile } from "./marking-file.entity";
import { MarkingFilesService } from "./marking-files.service";
import { ReadyToShipController } from "./ready-to-ship.controller";
import { LoadListController } from "./load-list.controller";
import { LoadListService } from "./load-list.service";
import { ReadyToShipService } from "./ready-to-ship.service";
import { ShippingContainer } from "./shipping-container.entity";
import { ShippingContainersController } from "./shipping-containers.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ShippingContainer,
      ContainerLineAllocation,
      AllocationAction,
      MarkingFile,
      LoadList,
    ]),
    FilesModule,
  ],
  controllers: [
    ReadyToShipController,
    LoadListController,
    ShippingContainersController,
    ContainerAllocationsController,
  ],
  providers: [
    ReadyToShipService,
    LoadListService,
    MarkingFilesService,
    AllocationRelinkService,
  ],
  exports: [AllocationRelinkService],
})
export class ReadyToShipModule {}
