import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { RequestUser } from "../common/auth/request-user.interface";
import { Role } from "../common/enums/role.enum";
import { DownloadableFile, FilesService } from "../files/files.service";
import { User } from "../users/user.entity";
import { ContainerLineAllocation } from "./container-line-allocation.entity";
import { MarkingFile } from "./marking-file.entity";

const STORED_FILE_URL = /^\/files\/([^/]+)\/download$/;

/**
 * One marking file per allocation row. Upload/delete are client-only,
 * download is both roles; ownership is checked here against the
 * allocation's container's customer (404 for a foreign row, like every
 * other client-facing lookup in this project).
 */
@Injectable()
export class MarkingFilesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly filesService: FilesService,
  ) {}

  /** Replaces any existing file for the allocation. Only for confirmed containers. */
  async upload(
    allocationId: string,
    file: Express.Multer.File,
    actor: RequestUser,
  ): Promise<{ id: string; allocationId: string; uploadedAt: Date }> {
    this.requireClient(actor);
    const allocation = await this.findAllocationForActor(allocationId, actor);
    if (!allocation.container.isConfirmed) {
      throw new BadRequestException(
        "маркировку можно загружать только для подтверждённого контейнера",
      );
    }

    const stored = await this.filesService.save(file, actor.id);
    const uploadedAt = new Date();
    const saved = await this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(MarkingFile);
      await repo.delete({ allocation: { id: allocation.id } });
      return repo.save(
        repo.create({
          allocation: { id: allocation.id } as ContainerLineAllocation,
          fileUrl: `/files/${stored.id}/download`,
          uploadedBy: { id: actor.id } as User,
          uploadedAt,
        }),
      );
    });

    return { id: saved.id, allocationId: allocation.id, uploadedAt };
  }

  async remove(allocationId: string, actor: RequestUser): Promise<void> {
    this.requireClient(actor);
    const allocation = await this.findAllocationForActor(allocationId, actor);
    const repo = this.dataSource.manager.getRepository(MarkingFile);
    const existing = await repo.findOne({
      where: { allocation: { id: allocation.id } },
    });
    if (!existing) {
      throw new NotFoundException("у этой позиции нет файла маркировки");
    }
    await repo.delete({ id: existing.id });
  }

  async download(
    allocationId: string,
    actor: RequestUser,
  ): Promise<DownloadableFile> {
    const allocation = await this.findAllocationForActor(allocationId, actor);
    const marking = await this.dataSource.manager
      .getRepository(MarkingFile)
      .findOne({ where: { allocation: { id: allocation.id } } });
    const fileId = marking
      ? STORED_FILE_URL.exec(marking.fileUrl)?.[1]
      : undefined;
    if (!marking || !fileId) {
      throw new NotFoundException("у этой позиции нет файла маркировки");
    }
    return this.filesService.openStoredFile(fileId);
  }

  private requireClient(actor: RequestUser): void {
    if (actor.role !== Role.CLIENT) {
      throw new ForbiddenException("Действие доступно только клиенту");
    }
  }

  private async findAllocationForActor(
    allocationId: string,
    actor: RequestUser,
  ): Promise<ContainerLineAllocation> {
    const allocation = await this.dataSource.manager
      .getRepository(ContainerLineAllocation)
      .findOne({
        where: { id: allocationId },
        relations: ["container", "container.customer"],
      });
    if (
      !allocation ||
      (actor.role === Role.CLIENT &&
        allocation.container.customer.id !== actor.customerId)
    ) {
      throw new NotFoundException(
        `ContainerLineAllocation ${allocationId} not found`,
      );
    }
    return allocation;
  }
}
