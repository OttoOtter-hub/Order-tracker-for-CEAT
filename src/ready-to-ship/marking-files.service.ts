import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { RequestUser } from "../common/auth/request-user.interface";
import { Role } from "../common/enums/role.enum";
import { apiError } from "../common/errors/api-error";
import { AuditLogService } from "../audit-log/audit-log.service";
import { DownloadableFile, FilesService } from "../files/files.service";
import { User } from "../users/user.entity";
import { ContainerLineAllocation } from "./container-line-allocation.entity";
import { MarkingFile } from "./marking-file.entity";
import { ShippingContainer } from "./shipping-container.entity";
import { markingArchiveName, markingEntryNames } from "./utils/marking-zip";

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
  private readonly logger = new Logger(MarkingFilesService.name);

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

  /**
   * Phase 24: what goes into a container's marking ZIP — every marking file
   * of its positions as of now, named "<material>_<original name>" (repeats
   * get _2, _3 …). Both roles; a client only for their own customer's
   * container (another's or an unknown one: 404 NOT_FOUND). No file at all:
   * 404 NO_MARKING_FILES. A file whose record exists but whose bytes are
   * missing from disk is left out and logged — the rest still downloads.
   */
  async prepareContainerArchive(
    containerId: string,
    actor: RequestUser,
  ): Promise<{
    fileName: string;
    entries: { name: string; path: string }[];
    skipped: number;
  }> {
    const container = await this.dataSource.manager
      .getRepository(ShippingContainer)
      .findOne({ where: { id: containerId }, relations: ["customer"] });
    if (
      !container ||
      (actor.role === Role.CLIENT && container.customer.id !== actor.customerId)
    ) {
      throw new NotFoundException(
        apiError("NOT_FOUND", `ShippingContainer ${containerId} not found`),
      );
    }

    // The container's positions, then their files: two plain lookups.
    const allocations = await this.dataSource.manager
      .getRepository(ContainerLineAllocation)
      .find({
        where: { container: { id: container.id } },
        relations: ["piLineItem"],
      });
    const allocationById = new Map(allocations.map((a) => [a.id, a]));
    const markings = allocations.length
      ? await this.dataSource.manager.getRepository(MarkingFile).find({
          where: { allocation: { id: In([...allocationById.keys()]) } },
          relations: ["allocation"],
          order: { uploadedAt: "ASC" },
        })
      : [];
    const withIds = markings
      .map((marking) => ({
        marking,
        fileId: STORED_FILE_URL.exec(marking.fileUrl)?.[1],
      }))
      .filter((m): m is { marking: MarkingFile; fileId: string } => !!m.fileId);
    if (withIds.length === 0) {
      throw new NotFoundException(
        apiError("NO_MARKING_FILES", "в контейнере нет файлов маркировки"),
      );
    }

    const located = await this.filesService.locateStoredFiles(
      withIds.map((m) => m.fileId),
    );
    const present = withIds.filter((m) => {
      const found = located.get(m.fileId);
      if (!found?.fullPath) {
        this.logger.warn(
          `marking ZIP of ${container.label} (${container.id}): file ${m.fileId} of allocation ${m.marking.allocation.id} is missing ${found ? "on disk" : "from stored_files"} — left out`,
        );
        return false;
      }
      return true;
    });
    if (present.length === 0) {
      throw new NotFoundException(
        apiError("NO_MARKING_FILES", "в контейнере нет файлов маркировки"),
      );
    }

    const names = markingEntryNames(
      present.map((m) => ({
        materialNum:
          allocationById.get(m.marking.allocation.id)?.piLineItem
            ?.materialNum ?? null,
        originalName: located.get(m.fileId)!.file.originalName,
      })),
    );
    return {
      fileName: markingArchiveName(container.label, container.name),
      entries: present.map((m, i) => ({
        name: names[i],
        path: located.get(m.fileId)!.fullPath!,
      })),
      skipped: withIds.length - present.length,
    };
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
