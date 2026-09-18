import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FilesModule } from "../files/files.module";
import { AllocationAction } from "./allocation-action.entity";
import { AllocationRelinkService } from "./allocation-relink.service";
import { ContainerAllocationsController } from "./container-allocations.controller";
import { ContainerLineAllocation } from "./container-line-allocation.entity";
import { MarkingFile } from "./marking-file.entity";
import { MarkingFilesService } from "./marking-files.service";
import { ReadyToShipController } from "./ready-to-ship.controller";
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
    ]),
    FilesModule,
  ],
  controllers: [
    ReadyToShipController,
    ShippingContainersController,
    ContainerAllocationsController,
  ],
  providers: [ReadyToShipService, MarkingFilesService, AllocationRelinkService],
  exports: [AllocationRelinkService],
})
export class ReadyToShipModule {}
