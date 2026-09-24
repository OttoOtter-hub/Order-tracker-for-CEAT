import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { RequestUser } from "../common/auth/request-user.interface";
import { Role } from "../common/enums/role.enum";
import { apiError } from "../common/errors/api-error";
import { AuditLogService } from "../audit-log/audit-log.service";
import { DownloadableFile, FilesService } from "../files/files.service";
import { User } from "../users/user.entity";
import { ContainerLineAllocation } from "./container-line-allocation.entity";
import { MarkingFile } from "./marking-file.entity";

const STORED_FILE_URL = /^\/files\/([^/]+)\/download$/;

/** Which position a marking file belongs to, for the action journal. */
function describeAllocation(allocation: ContainerLineAllocation) {
  return {
    containerLabel: allocation.container.label,
    allocationId: allocation.id,
    piNumber: allocation.piLineItem?.pi?.piNumber ?? null,
    materialNum: allocation.piLineItem?.materialNum ?? null,
  };
}

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
    private readonly audit: AuditLogService,
  ) {}

  /** Replaces any existing file for the allocation. Only once that position is locked. */
  async upload(
    allocationId: string,
    file: Express.Multer.File,
    actor: RequestUser,
  ): Promise<{ id: string; allocationId: string; uploadedAt: Date }> {
    this.requireClient(actor);
    const allocation = await this.findAllocationForActor(allocationId, actor);
    if (!allocation.isLocked) {
      throw new BadRequestException(
        apiError(
          "MARKING_REQUIRES_LOCKED_ALLOCATION",
          "маркировку можно загружать только для подтверждённой позиции",
        ),
      );
    }

    const stored = await this.filesService.save(file, actor.id);
    const uploadedAt = new Date();
    const saved = await this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(MarkingFile);
      const replaced = await repo.delete({ allocation: { id: allocation.id } });
      const marking = await repo.save(
        repo.create({
          allocation: { id: allocation.id } as ContainerLineAllocation,
          fileUrl: `/files/${stored.id}/download`,
          uploadedBy: { id: actor.id } as User,
          uploadedAt,
        }),
      );
      await this.audit.record(
        {
          actor,
          action: "rts.marking_uploaded",
          entityType: "shipping_container",
          entityId: allocation.container.id,
          metadata: {
            ...describeAllocation(allocation),
            fileName: stored.originalName,
            fileUrl: marking.fileUrl,
            replacedPrevious: (replaced.affected ?? 0) > 0,
          },
        },
        em,
      );
      return marking;
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
      throw new NotFoundException(
        apiError("NO_MARKING_FILE", "у этой позиции нет файла маркировки"),
      );
    }
    await repo.delete({ id: existing.id });
    await this.audit.record({
      actor,
      action: "rts.marking_deleted",
      entityType: "shipping_container",
      entityId: allocation.container.id,
      metadata: {
        ...describeAllocation(allocation),
        fileUrl: existing.fileUrl,
      },
    });
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
      throw new NotFoundException(
        apiError("NO_MARKING_FILE", "у этой позиции нет файла маркировки"),
      );
    }
    return this.filesService.openStoredFile(fileId);
  }

  private requireClient(actor: RequestUser): void {
    if (actor.role !== Role.CLIENT) {
      throw new ForbiddenException(
        apiError("CLIENT_ONLY_ACTION", "Действие доступно только клиенту"),
      );
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
        relations: [
          "container",
          "container.customer",
          "piLineItem",
          "piLineItem.pi",
        ],
      });
    if (
      !allocation ||
      (actor.role === Role.CLIENT &&
        allocation.container.customer.id !== actor.customerId)
    ) {
      throw new NotFoundException(
        apiError(
          "NOT_FOUND",
          `ContainerLineAllocation ${allocationId} not found`,
        ),
      );
    }
    return allocation;
  }
}
