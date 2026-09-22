import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CustomersModule } from "../customers/customers.module";
import { FilesModule } from "../files/files.module";
import { ActualContainer } from "./actual-container.entity";
import { ActualContainerFile } from "./actual-container-file.entity";
import { ActualContainerLineItem } from "./actual-container-line-item.entity";
import { ActualContainersImportService } from "./actual-containers-import.service";
import {
  ActualContainerFilesController,
  ActualContainersController,
} from "./actual-containers.controller";
import { ActualContainersService } from "./actual-containers.service";
import { ArrivalNotificationsService } from "./arrival-notifications.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ActualContainer,
      ActualContainerLineItem,
      ActualContainerFile,
    ]),
    CustomersModule,
    FilesModule,
  ],
  controllers: [ActualContainersController, ActualContainerFilesController],
  providers: [
    ActualContainersService,
    ActualContainersImportService,
    ArrivalNotificationsService,
  ],
  exports: [ActualContainersImportService],
})
export class ActualContainersModule {}
