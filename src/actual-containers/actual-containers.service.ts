import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { FindOptionsWhere, Repository } from "typeorm";
import { RequestUser } from "../common/auth/request-user.interface";
import { Role } from "../common/enums/role.enum";
import { apiError } from "../common/errors/api-error";
import { DownloadableFile, FilesService } from "../files/files.service";
import { User } from "../users/user.entity";
import { ActualContainer } from "./actual-container.entity";
import { ActualContainerFile } from "./actual-container-file.entity";
import { UpdateContainerDatesDto } from "./dto/update-container-dates.dto";

const STORED_FILE_URL = /^\/files\/([^/]+)\/download$/;

/** Newest first; a container without any date sinks to the bottom. */
function byEffectiveEtdDesc(a: ActualContainer, b: ActualContainer): number {
  const ae = a.overrideEtd ?? a.sourceEtd ?? null;
  const be = b.overrideEtd ?? b.sourceEtd ?? null;
  if (ae !== be) {
    if (ae === null) return 1;
    if (be === null) return -1;
    return ae < be ? 1 : -1;
  }
  return a.containerNumber < b.containerNumber ? -1 : 1;
}

/**
 * Read for both roles, write for ops only (the controllers say which is
 * which). client is scoped to their own customer here, in the service — a
 * foreign or unknown id is a 404 either way, so ids can't be probed.
 */
@Injectable()
export class ActualContainersService {
  constructor(
    @InjectRepository(ActualContainer)
    private readonly containerRepo: Repository<ActualContainer>,
    @InjectRepository(ActualContainerFile)
    private readonly fileRepo: Repository<ActualContainerFile>,
    private readonly filesService: FilesService,
  ) {}

  async findAll(actor: RequestUser): Promise<ActualContainer[]> {
    const where = this.scope(actor);
    if (!where) {
      return [];
    }
    const containers = await this.containerRepo.find({
      where,
      relations: ["files", "arrivalConfirmedByUser"],
    });
    // The list needs only "is there a file", so the rows themselves stay home.
    for (const container of containers) {
      container.filesCount = container.files?.length ?? 0;
      delete (container as { files?: unknown }).files;
    }
    return containers.sort(byEffectiveEtdDesc);
  }

  async findOne(id: string, actor: RequestUser): Promise<ActualContainer> {
    const where = this.scope(actor);
    const container = where
      ? await this.containerRepo.findOne({
          where: { ...where, id },
          relations: [
            "lineItems",
            "files",
            "files.uploadedBy",
            "arrivalConfirmedByUser",
          ],
        })
      : null;
    if (!container) {
      throw new NotFoundException(
        apiError("NOT_FOUND", `ActualContainer ${id} not found`),
      );
    }
    container.lineItems.sort(
      (a, b) =>
        (a.piNumber ?? "").localeCompare(b.piNumber ?? "") ||
        (a.invoiceNumber ?? "").localeCompare(b.invoiceNumber ?? "") ||
        (a.materialNum ?? "").localeCompare(b.materialNum ?? ""),
    );
    container.files.sort(
      (a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt),
    );
    container.filesCount = container.files.length;
    return container;
  }

  /** Sets and/or clears the manual dates; the file-sourced ones are never touched. */
  async updateDates(
    id: string,
    dto: UpdateContainerDatesDto,
    actor: RequestUser,
  ): Promise<ActualContainer> {
    if (dto.overrideEtd === undefined && dto.overrideEta === undefined) {
      throw new BadRequestException(
        apiError(
          "DATE_OVERRIDE_EMPTY",
          "provide overrideEtd and/or overrideEta (a date, or null to clear it)",
        ),
      );
    }
    const container = await this.findOne(id, actor);
    if (dto.overrideEtd !== undefined) {
      container.overrideEtd = dto.overrideEtd;
    }
    if (dto.overrideEta !== undefined) {
      container.overrideEta = dto.overrideEta;
    }
    await this.containerRepo.update(
      { id: container.id },
      {
        overrideEtd: container.overrideEtd,
        overrideEta: container.overrideEta,
      },
    );
    return this.findOne(id, actor);
  }

  /** Back to the file's own dates: both overrides cleared. */
  async resetDates(id: string, actor: RequestUser): Promise<ActualContainer> {
    const container = await this.findOne(id, actor);
    await this.containerRepo.update(
      { id: container.id },
      { overrideEtd: null, overrideEta: null },
    );
    return this.findOne(id, actor);
  }

  /**
   * client-only (the controller's @ClientWriteAllowed() lets client past
   * RolesGuard for this POST; ops also reaches the handler — "ops always
   * allowed" — so it's rejected explicitly here, same pattern as
   * ProformaInvoicesService.resetPriority). Owner-check via findOne, which
   * 404s a foreign or unknown id for a client the same way every other
   * client-facing read/write on this service does.
   */
  async confirmArrival(
    id: string,
    actor: RequestUser,
  ): Promise<ActualContainer> {
    if (actor.role !== Role.CLIENT) {
      throw new ForbiddenException(
        apiError(
          "CLIENT_ONLY_ACTION",
          "Подтвердить прибытие может только клиент",
        ),
      );
    }
    const container = await this.findOne(id, actor);
    if (container.arrivalConfirmedAt) {
      throw new BadRequestException(
        apiError("ARRIVAL_ALREADY_CONFIRMED", "прибытие уже подтверждено"),
      );
    }
    // A relation write (arrivalConfirmedByUser), so .save() on the loaded
    // entity — same pattern as every other "*By" actor field in this
    // codebase (e.g. ProformaInvoicesService.uploadPi's piFileUploadedBy) —
    // rather than .update(), which the rest of this service uses only for
    // plain columns (updateDates/resetDates).
    container.arrivalConfirmedAt = new Date();
    container.arrivalConfirmedByUser = { id: actor.id } as User;
    await this.containerRepo.save(container);
    return this.findOne(id, actor);
  }

  /**
   * Ops-only undo of a client's mistaken confirm-arrival. arrival_confirmed_at
   * is only ever written by confirmArrival — the automatic "arrived 7+ days
   * after ETA" is computed, never stored — so "is it set" is exactly "was
   * there a manual confirmation". An auto-arrived container therefore 400s
   * here like any unconfirmed one: there is nothing stored to clear. After a
   * revoke, arrivalStatus simply recomputes from the date — back to
   * "expected" before the 7-day mark, still "arrived" (automatic) past it.
   */
  async revokeArrivalConfirmation(
    id: string,
    actor: RequestUser,
  ): Promise<ActualContainer> {
    if (actor.role !== Role.OPS) {
      throw new ForbiddenException(
        apiError(
          "OPS_ONLY_ACTION",
          "Отменить подтверждение прибытия может только CEAT",
        ),
      );
    }
    const container = await this.findOne(id, actor);
    if (!container.arrivalConfirmedAt) {
      throw new BadRequestException(
        apiError("ARRIVAL_NOT_CONFIRMED", "прибытие не было подтверждено"),
      );
    }
    container.arrivalConfirmedAt = null;
    container.arrivalConfirmedByUser = null;
    await this.containerRepo.save(container);
    return this.findOne(id, actor);
  }

  async addFile(
    id: string,
    file: Express.Multer.File,
    description: string | undefined,
    actor: RequestUser,
  ): Promise<ActualContainerFile> {
    const container = await this.findOne(id, actor);
    const stored = await this.filesService.save(file, actor.id);
    const saved = await this.fileRepo.save(
      this.fileRepo.create({
        actualContainer: { id: container.id } as ActualContainer,
        fileUrl: `/files/${stored.id}/download`,
        fileName: stored.originalName ?? file.originalname,
        uploadedBy: { id: actor.id } as User,
        uploadedAt: new Date(),
        description: description?.trim() ? description.trim() : null,
      }),
    );
    return saved;
  }

  async removeFile(fileId: string): Promise<void> {
    const existing = await this.fileRepo.findOne({ where: { id: fileId } });
    if (!existing) {
      throw new NotFoundException(
        apiError("NOT_FOUND", `ActualContainerFile ${fileId} not found`),
      );
    }
    await this.fileRepo.delete({ id: fileId });
  }

  async downloadFile(
    fileId: string,
    actor: RequestUser,
  ): Promise<DownloadableFile> {
    const file = await this.fileRepo.findOne({
      where: { id: fileId },
      relations: ["actualContainer", "actualContainer.customer"],
    });
    if (
      !file ||
      (actor.role === Role.CLIENT &&
        file.actualContainer.customer.id !== actor.customerId)
    ) {
      throw new NotFoundException(
        apiError("NOT_FOUND", `ActualContainerFile ${fileId} not found`),
      );
    }
    const storedFileId = STORED_FILE_URL.exec(file.fileUrl)?.[1];
    if (!storedFileId) {
      throw new NotFoundException(
        apiError("NOT_FOUND", `ActualContainerFile ${fileId} not found`),
      );
    }
    return this.filesService.openStoredFile(storedFileId);
  }

  /** null = this actor can see nothing (a client that belongs to no customer). */
  private scope(actor: RequestUser): FindOptionsWhere<ActualContainer> | null {
    if (actor.role !== Role.CLIENT) {
      return {};
    }
    return actor.customerId ? { customer: { id: actor.customerId } } : null;
  }
}
