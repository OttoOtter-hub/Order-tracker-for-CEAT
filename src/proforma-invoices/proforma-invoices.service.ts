import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { In, Repository } from "typeorm";
import { ActualContainerLineItem } from "../actual-containers/actual-container-line-item.entity";
import { ContainerLineAllocation } from "../ready-to-ship/container-line-allocation.entity";
import { CustomersService } from "../customers/customers.service";
import { FilesService } from "../files/files.service";
import { PiAdditionalFile } from "../pi-additional-files/pi-additional-file.entity";
import { PiLineItem } from "../pi-line-items/pi-line-item.entity";
import { Role } from "../common/enums/role.enum";
import { RequestUser } from "../common/auth/request-user.interface";
import { User } from "../users/user.entity";
import { ProformaInvoice } from "./proforma-invoice.entity";
import { PiCreatedFrom } from "./enums/pi-created-from.enum";
import { extractPiNumber } from "./utils/extract-pi-number";
import { isUniqueViolation } from "../common/utils/is-unique-violation";
import { buildPiExportWorkbook } from "./utils/build-pi-export-workbook";
import {
  computeReconciliation,
  ReconciliationRow,
} from "./utils/compute-reconciliation";
import { formatDateForFilename } from "../common/utils/format-date";
import { NotificationEvent } from "../notifications/notification-events";

@Injectable()
export class ProformaInvoicesService {
  constructor(
    @InjectRepository(ProformaInvoice)
    private readonly repo: Repository<ProformaInvoice>,
    @InjectRepository(PiAdditionalFile)
    private readonly additionalFilesRepo: Repository<PiAdditionalFile>,
    @InjectRepository(PiLineItem)
    private readonly lineItemsRepo: Repository<PiLineItem>,
    @InjectRepository(ContainerLineAllocation)
    private readonly allocationsRepo: Repository<ContainerLineAllocation>,
    @InjectRepository(ActualContainerLineItem)
    private readonly actualLineItemsRepo: Repository<ActualContainerLineItem>,
    private readonly filesService: FilesService,
    private readonly customersService: CustomersService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  findAll(): Promise<ProformaInvoice[]> {
    return this.repo.find({
      relations: [
        "customer",
        "lineItems",
        "additionalFiles",
        "additionalFiles.uploadedBy",
      ],
      order: { createdAt: "DESC" },
    });
  }

  async findOne(id: string): Promise<ProformaInvoice> {
    const pi = await this.repo.findOne({
      where: { id },
      relations: [
        "customer",
        "lineItems",
        "additionalFiles",
        "additionalFiles.uploadedBy",
        "piFileUploadedBy",
        "signedFileUploadedBy",
        "pendingReplacementProposedBy",
      ],
    });
    if (!pi) {
      throw new NotFoundException(`ProformaInvoice ${id} not found`);
    }
    pi.reconciliation = await this.buildReconciliation(pi);
    return pi;
  }

  /**
   * Phase 12: plan-vs-actual per material for this one card (see
   * computeReconciliation for the grouping/filtering rules). Two read-only
   * queries, run for every findOne() — including every write on this service,
   * since they all reload through it — not for findAll()'s list, which stays
   * at its original query count.
   */
  private async buildReconciliation(
    pi: ProformaInvoice,
  ): Promise<ReconciliationRow[]> {
    const lineItems = pi.lineItems ?? [];
    const lineItemIds = lineItems.map((item) => item.id);
    const [allocations, actualLines] = await Promise.all([
      lineItemIds.length
        ? this.allocationsRepo.find({
            where: { piLineItem: { id: In(lineItemIds) } },
            relations: ["piLineItem", "container"],
          })
        : Promise.resolve([]),
      this.actualLineItemsRepo.find({
        where: { piNumber: pi.piNumber },
        select: { materialNum: true, quantity: true },
      }),
    ]);
    return computeReconciliation(lineItems, allocations, actualLines);
  }

  /**
   * `CustomerScopeInterceptor` only filters the *response* — for a write it
   * would let a mutation against another customer's PI go through and only
   * 404 on the way out. Every client-facing write below loads through this
   * instead, so a cross-customer request never reaches `repo.save()`. No-op
   * for ops (actor.role === OPS), matching RolesGuard's own "ops always
   * allowed" rule.
   */
  private async findOwnedByActor(
    id: string,
    actor: RequestUser,
  ): Promise<ProformaInvoice> {
    const pi = await this.findOne(id);
    if (actor.role === Role.CLIENT && pi.customer.id !== actor.customerId) {
      throw new NotFoundException(`ProformaInvoice ${id} not found`);
    }
    return pi;
  }

  /**
   * Ops uploads the original PI file. The PI number is read from the
   * filename (see extractPiNumber), not a form field — matches how the
   * factory's own file-naming convention already works.
   *
   * - Number not found in the filename -> 400, nothing saved.
   * - A card with this number already has a pi_file_url -> 409: this
   *   endpoint is for the original document only; a second original file
   *   for an already-filed number goes through propose-replacement instead.
   * - A card exists but pi_file_url is still empty (created from a
   *   backorder row) -> fill in the file fields on that card.
   * - No card exists yet -> create one (createdFrom = PI_UPLOAD).
   */
  async uploadPi(
    file: Express.Multer.File,
    actor: RequestUser,
  ): Promise<ProformaInvoice> {
    const piNumber = extractPiNumber(file.originalname);
    if (!piNumber) {
      throw new BadRequestException(
        "не удалось распознать номер PI из имени файла",
      );
    }

    const existing = await this.repo.findOne({
      where: { piNumber },
      relations: ["customer"],
    });
    if (existing?.piFileUrl) {
      throw new ConflictException(
        "проформа с этим номером уже загружена, используйте предложение замены",
      );
    }

    const fileUrl = await this.storeUploadedFile(file, actor.id);

    if (existing) {
      existing.piFileUrl = fileUrl;
      existing.piFileUploadedAt = new Date();
      existing.piFileUploadedBy = { id: actor.id } as User;
      const saved = await this.repo.save(existing);
      this.emitPiReadyToSign(
        saved.piNumber,
        saved.label ?? null,
        existing.customer.id,
      );
      return this.findOne(saved.id);
    }

    // TODO(multi-client): customersService.findFirst() picks "the" customer
    // because the pilot has exactly one. Once a second customer exists,
    // this needs an explicit customerId chosen by the uploader.
    const customer = await this.customersService.findFirst();
    const pi = this.repo.create({
      piNumber,
      customer,
      createdFrom: PiCreatedFrom.PI_UPLOAD,
      piFileUrl: fileUrl,
      piFileUploadedAt: new Date(),
      piFileUploadedBy: { id: actor.id } as User,
    });
    try {
      const saved = await this.repo.save(pi);
      this.emitPiReadyToSign(saved.piNumber, saved.label ?? null, customer.id);
      return this.findOne(saved.id);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          "проформа с этим номером уже загружена, используйте предложение замены",
        );
      }
      throw err;
    }
  }

  /**
   * Event 1 (Phase 13): fires right after uploadPi sets pi_file_url —
   * signed_file_url is never set by this method, so the resulting status is
   * always MISSING_SIGNED_DOCUMENT, unconditionally.
   */
  private emitPiReadyToSign(
    piNumber: string,
    label: string | null,
    customerId: string,
  ): void {
    this.eventEmitter.emit(NotificationEvent.PI_READY_TO_SIGN, {
      piNumber,
      label,
      customerId,
    });
  }

  /** Client uploads their signed copy — always overwrites, no approval. */
  async uploadSigned(
    id: string,
    file: Express.Multer.File,
    actor: RequestUser,
  ): Promise<ProformaInvoice> {
    const pi = await this.findOwnedByActor(id, actor);
    const fileUrl = await this.storeUploadedFile(file, actor.id);
    pi.signedFileUrl = fileUrl;
    pi.signedFileUploadedAt = new Date();
    pi.signedFileUploadedBy = { id: actor.id } as User;
    const saved = await this.repo.save(pi);
    return this.findOne(saved.id);
  }

  /** Either role, no limit on count — free-form attachments. */
  async addAdditionalFile(
    id: string,
    file: Express.Multer.File,
    description: string | undefined,
    actor: RequestUser,
  ): Promise<PiAdditionalFile> {
    const pi = await this.findOwnedByActor(id, actor);
    const fileUrl = await this.storeUploadedFile(file, actor.id);
    const additionalFile = this.additionalFilesRepo.create({
      pi,
      fileUrl,
      uploadedBy: { id: actor.id } as User,
      uploadedAt: new Date(),
      description: description ?? null,
    });
    return this.additionalFilesRepo.save(additionalFile);
  }

  /**
   * Ops proposes a replacement for the original PI file. Only one
   * outstanding proposal at a time — a second proposal on top of an
   * unresolved one is rejected rather than silently overwriting it.
   */
  async proposeReplacement(
    id: string,
    file: Express.Multer.File,
    actor: RequestUser,
  ): Promise<ProformaInvoice> {
    const pi = await this.findOne(id);
    if (pi.pendingReplacementFileUrl) {
      throw new ConflictException(
        "уже есть предложение замены, ожидающее решения клиента",
      );
    }
    const fileUrl = await this.storeUploadedFile(file, actor.id);
    pi.pendingReplacementFileUrl = fileUrl;
    pi.pendingReplacementProposedBy = { id: actor.id } as User;
    pi.pendingReplacementProposedAt = new Date();
    const saved = await this.repo.save(pi);
    this.eventEmitter.emit(NotificationEvent.PI_REPLACEMENT_PROPOSED, {
      piNumber: saved.piNumber,
      label: saved.label ?? null,
      customerId: pi.customer.id,
    });
    return this.findOne(saved.id);
  }

  /**
   * Client approves or rejects the pending replacement. Approving moves the
   * proposed file into the pi_file_* slot itself (including who/when
   * *uploaded* it — the ops user who proposed it — so that metadata still
   * describes the file actually sitting at pi_file_url, not the original
   * one it replaced); rejecting just clears the proposal and leaves
   * pi_file_url untouched.
   */
  async replacementDecision(
    id: string,
    approved: boolean,
    actor: RequestUser,
  ): Promise<ProformaInvoice> {
    const pi = await this.findOwnedByActor(id, actor);
    if (!pi.pendingReplacementFileUrl) {
      throw new BadRequestException(
        "нет активного предложения замены для этого PI",
      );
    }
    if (approved) {
      pi.piFileUrl = pi.pendingReplacementFileUrl;
      pi.piFileUploadedAt = pi.pendingReplacementProposedAt;
      pi.piFileUploadedBy = pi.pendingReplacementProposedBy;
    }
    pi.pendingReplacementFileUrl = null;
    pi.pendingReplacementProposedBy = null;
    pi.pendingReplacementProposedAt = null;
    const saved = await this.repo.save(pi);
    return this.findOne(saved.id);
  }

  private async storeUploadedFile(
    file: Express.Multer.File,
    uploadedBy: string,
  ): Promise<string> {
    const stored = await this.filesService.save(file, uploadedBy);
    return `/files/${stored.id}/download`;
  }

  /**
   * ops can export any card; client only their own — enforced the same way
   * as every other client-reachable action here (findOwnedByActor), not
   * left to a response-shape-sensitive interceptor (this returns a raw
   * Buffer, which @ScopeByCustomer/CustomerScopeInterceptor couldn't
   * meaningfully scope anyway).
   */
  async exportXlsx(
    id: string,
    actor: RequestUser,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const pi = await this.findOwnedByActor(id, actor);
    const workbook = buildPiExportWorkbook(pi);
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const fileName = `PI_${pi.piNumber}_export_${formatDateForFilename(new Date())}.xlsx`;
    return { buffer: Buffer.from(arrayBuffer), fileName };
  }

  /**
   * The client names their card — only until it is signed. Once
   * signed_file_url is set (and nothing ever clears it) the name is locked
   * for good, whether or not it was ever filled in: no unlock path exists.
   * Client-only like resetPriority (RolesGuard would let ops through the
   * @ClientWriteAllowed handler, so the role check is explicit); a blank
   * name is stored as null.
   */
  async updateLabel(
    id: string,
    label: string | null,
    actor: RequestUser,
  ): Promise<ProformaInvoice> {
    if (actor.role !== Role.CLIENT) {
      throw new ForbiddenException("Название может задавать только клиент");
    }
    const pi = await this.findOwnedByActor(id, actor);
    if (pi.signedFileUrl) {
      throw new BadRequestException(
        "название можно менять только до подписания проформы",
      );
    }
    const trimmed = label === null ? "" : label.trim();
    await this.repo.update(
      { id: pi.id },
      { label: trimmed === "" ? null : trimmed },
    );
    return this.findOne(pi.id);
  }

  /**
   * Client-only, same reasoning as PiLineItemsService.updatePriority — ops
   * can see priority (a plain column in the API response) but must not
   * change it directly, and RolesGuard's "ops always allowed" rule doesn't
   * stop that here, so the role check is explicit rather than left to a
   * decorator. Zeroes every PiLineItem's priorityQty for this PI in one
   * UPDATE statement, not a loop of N per-row writes from the caller —
   * a single SQL statement is already atomic (nothing to leave half-done
   * if it fails partway), and it's one round-trip instead of N regardless
   * of how many line items the card has.
   */
  async resetPriority(
    id: string,
    actor: RequestUser,
  ): Promise<ProformaInvoice> {
    if (actor.role !== Role.CLIENT) {
      throw new ForbiddenException("Сброс приоритета доступен только клиенту");
    }
    const pi = await this.findOwnedByActor(id, actor);
    await this.lineItemsRepo.update(
      { pi: { id: pi.id } },
      { priorityQty: "0" },
    );
    return this.findOne(pi.id);
  }
}
