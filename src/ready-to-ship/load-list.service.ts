import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager, In } from "typeorm";
import { AuditLogService } from "../audit-log/audit-log.service";
import { RequestUser } from "../common/auth/request-user.interface";
import { Role } from "../common/enums/role.enum";
import { ErrorDetail, apiError } from "../common/errors/api-error";
import { toNumberOrNull } from "../common/utils/numeric";
import { formatDateForFilename } from "../common/utils/format-date";
import { Customer } from "../customers/customer.entity";
import {
  LoadListEventPayload,
  NotificationEvent,
} from "../notifications/notification-events";
import { PiLineItem } from "../pi-line-items/pi-line-item.entity";
import { AllocationAction } from "./allocation-action.entity";
import { ContainerLineAllocation } from "./container-line-allocation.entity";
import { LoadList, LoadListStatus } from "./load-list.entity";
import {
  assertEditable,
  clearUndoLog,
  findOrCreateLoadList,
  keyString,
  lineKeyOf,
  requireStatus,
  takeSnapshot,
} from "./load-list-state";
import type {
  LoadListAdjustment,
  LoadListSnapshot,
  SnapshotContainer,
} from "./load-list.types";
import { MarkingFile } from "./marking-file.entity";
import {
  MAX_MANUAL_CONTAINERS,
  ReadyToShipService,
} from "./ready-to-ship.service";
import type { ReadyToShipView } from "./ready-to-ship.types";
import { ShippingContainer } from "./shipping-container.entity";
import {
  OK_TO_MIX,
  buildReadyToShipExportWorkbook,
} from "./utils/build-ready-to-ship-export-workbook";
import { isOverfilled, toFillPercent } from "./utils/compute-container-fill";
import { parseImportWorkbook, planImport } from "./utils/load-list-import";

const NUMBERED = /^\s*Контейнер\s+(\d+)\s*$/i;

/** "Контейнер 3" -> "3"; "OK to mix" as it is — what error texts show. */
function containerParam(label: string): string {
  const match = NUMBERED.exec(label);
  return match ? match[1] : label;
}

export const REJECTION_COMMENT_MAX_LENGTH = 1000;

/** One article whose placement differs between CEAT's and the client's version. */
export interface LoadListDiffLine {
  piNumber: string;
  materialNum: string | null;
  soNumber: string | null;
  materialDesc: string | null;
  changes: { container: string; ceatQty: number; clientQty: number }[];
}

export interface LoadListDiffContainer {
  label: string;
  isOkToMix: boolean;
  ceatQty: number;
  clientQty: number;
  /** null for OK to mix — it has no capacity. */
  ceatFillPercent: number | null;
  clientFillPercent: number | null;
}

export interface LoadListDiff {
  ceatTakenAt: string;
  clientTakenAt: string;
  lines: LoadListDiffLine[];
  containers: LoadListDiffContainer[];
}

/**
 * Phase 25: the load list goes back and forth between CEAT and the client.
 * Each transition locks the customer's LoadList row, checks the status it
 * starts from, journals itself, drops the undo log (it belongs to whoever
 * edited before), and — after the commit — notifies the other side.
 */
@Injectable()
export class LoadListService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly readyToShip: ReadyToShipService,
    private readonly eventEmitter: EventEmitter2,
    private readonly audit: AuditLogService,
  ) {}

  /** CEAT: draft_ceat -> sent_to_client, with a snapshot of CEAT's version. */
  async send(actor: RequestUser, requested?: string): Promise<ReadyToShipView> {
    const customerId = this.customer(actor, requested, Role.OPS);
    await this.dataSource.transaction(async (em) => {
      const loadList = await requireStatus(em, customerId, [
        LoadListStatus.DRAFT_CEAT,
      ]);
      const from = loadList.status;
      const plan = await this.readyToShip.lockPositions(em, customerId, actor, {
        checkOnly: true,
      });
      await em.getRepository(LoadList).update(
        { id: loadList.id },
        {
          status: LoadListStatus.SENT_TO_CLIENT,
          ceatSnapshot: await takeSnapshot(em, customerId, actor),
          clientSnapshot: null,
          sentAt: new Date(),
          sentById: actor.id,
          editRequestedAt: null,
          submittedAt: null,
          rejectedAt: null,
          rejectionComment: null,
          rejectionAdjustments: null,
        },
      );
      await clearUndoLog(em, customerId);
      await this.journal(em, actor, customerId, "rts.load_list_sent", {
        from,
        to: LoadListStatus.SENT_TO_CLIENT,
        containerLabels: plan.containerLabels,
      });
    });
    await this.notify(NotificationEvent.LOAD_LIST_SENT, customerId);
    return this.readyToShip.loadView(customerId, actor.role);
  }

  /** Client: sent_to_client -> confirmed, CEAT's version as it is. */
  async accept(
    actor: RequestUser,
    requested?: string,
  ): Promise<ReadyToShipView> {
    const customerId = this.customer(actor, requested, Role.CLIENT);
    await this.dataSource.transaction(async (em) => {
      const loadList = await requireStatus(em, customerId, [
        LoadListStatus.SENT_TO_CLIENT,
      ]);
      const from = loadList.status;
      const locked = await this.readyToShip.lockPositions(
        em,
        customerId,
        actor,
        { allowEmpty: true },
      );
      await this.setStatus(em, loadList, LoadListStatus.CONFIRMED, {
        confirmedAt: new Date(),
      });
      await this.journal(em, actor, customerId, "rts.load_list_accepted", {
        from,
        to: LoadListStatus.CONFIRMED,
        ...locked,
      });
    });
    await this.notify(NotificationEvent.LOAD_LIST_ACCEPTED, customerId);
    return this.readyToShip.loadView(customerId, actor.role);
  }

  /**
   * Client: sent_to_client -> client_editing at once (no separate approval
   * by CEAT — CEAT is told, and sees the edits as they happen).
   */
  async requestEdit(
    actor: RequestUser,
    requested?: string,
  ): Promise<ReadyToShipView> {
    const customerId = this.customer(actor, requested, Role.CLIENT);
    await this.dataSource.transaction(async (em) => {
      const loadList = await requireStatus(em, customerId, [
        LoadListStatus.SENT_TO_CLIENT,
      ]);
      const from = loadList.status;
      await this.setStatus(em, loadList, LoadListStatus.CLIENT_EDITING, {
        editRequestedAt: new Date(),
      });
      await this.journal(
        em,
        actor,
        customerId,
        "rts.load_list_edit_requested",
        {
          from,
          to: LoadListStatus.CLIENT_EDITING,
        },
      );
    });
    await this.notify(NotificationEvent.LOAD_LIST_EDIT_REQUESTED, customerId);
    return this.readyToShip.loadView(customerId, actor.role);
  }

  /** Client: client_editing -> submitted_by_client, with a snapshot of their version. */
  async submit(
    actor: RequestUser,
    requested?: string,
  ): Promise<ReadyToShipView> {
    const customerId = this.customer(actor, requested, Role.CLIENT);
    await this.dataSource.transaction(async (em) => {
      const loadList = await requireStatus(em, customerId, [
        LoadListStatus.CLIENT_EDITING,
      ]);
      const from = loadList.status;
      const plan = await this.readyToShip.lockPositions(em, customerId, actor, {
        checkOnly: true,
      });
      await this.setStatus(em, loadList, LoadListStatus.SUBMITTED_BY_CLIENT, {
        clientSnapshot: await takeSnapshot(em, customerId, actor),
        submittedAt: new Date(),
      });
      await this.journal(em, actor, customerId, "rts.load_list_submitted", {
        from,
        to: LoadListStatus.SUBMITTED_BY_CLIENT,
        containerLabels: plan.containerLabels,
      });
    });
    await this.notify(NotificationEvent.LOAD_LIST_SUBMITTED, customerId);
    return this.readyToShip.loadView(customerId, actor.role);
  }

  /**
   * CEAT: submitted_by_client -> confirmed with the client's version. Checked
   * again first against the current stock and loadability (a backorder
   * upload may have come in meanwhile): any mismatch refuses with
   * LOAD_LIST_OUTDATED and the list — CEAT then rejects.
   */
  async approve(
    actor: RequestUser,
    requested?: string,
  ): Promise<ReadyToShipView> {
    const customerId = this.customer(actor, requested, Role.OPS);
    await this.dataSource.transaction(async (em) => {
      const loadList = await requireStatus(em, customerId, [
        LoadListStatus.SUBMITTED_BY_CLIENT,
      ]);
      const from = loadList.status;
      const mismatches = await this.verifyClientVersion(
        em,
        customerId,
        loadList.clientSnapshot,
      );
      if (mismatches.length > 0) {
        throw new BadRequestException({
          ...apiError(
            "LOAD_LIST_OUTDATED",
            `версия клиента не сходится с текущими остатками (${mismatches.length})`,
            { count: mismatches.length },
          ),
          details: mismatches,
        });
      }
      const locked = await this.readyToShip.lockPositions(
        em,
        customerId,
        actor,
      );
      await this.setStatus(em, loadList, LoadListStatus.CONFIRMED, {
        confirmedAt: new Date(),
      });
      await this.journal(em, actor, customerId, "rts.load_list_approved", {
        from,
        to: LoadListStatus.CONFIRMED,
        ...locked,
      });
    });
    await this.notify(NotificationEvent.LOAD_LIST_APPROVED, customerId);
    return this.readyToShip.loadView(customerId, actor.role);
  }

  /**
   * CEAT: submitted_by_client -> sent_to_client. The client's edits are
   * undone: the layout goes back to CEAT's version (the confirmed positions
   * aside, which nobody could touch). Quantities CEAT's version had that the
   * current stock no longer covers are cut — journaled and shown with the
   * comment.
   */
  async reject(
    actor: RequestUser,
    comment: string | undefined,
    requested?: string,
  ): Promise<ReadyToShipView> {
    const customerId = this.customer(actor, requested, Role.OPS);
    const text = (comment ?? "").trim();
    if (!text) {
      throw new BadRequestException(
        apiError(
          "REJECTION_COMMENT_REQUIRED",
          "при отклонении нужен комментарий для клиента",
        ),
      );
    }
    let adjustments: LoadListAdjustment[] = [];
    await this.dataSource.transaction(async (em) => {
      const loadList = await requireStatus(em, customerId, [
        LoadListStatus.SUBMITTED_BY_CLIENT,
      ]);
      const from = loadList.status;
      adjustments = await this.restoreSnapshot(
        em,
        customerId,
        loadList.ceatSnapshot,
      );
      await this.setStatus(em, loadList, LoadListStatus.SENT_TO_CLIENT, {
        rejectedAt: new Date(),
        rejectionComment: text,
        rejectionAdjustments: adjustments,
      });
      await this.journal(em, actor, customerId, "rts.load_list_rejected", {
        from,
        to: LoadListStatus.SENT_TO_CLIENT,
        comment: text,
        ...(adjustments.length > 0
          ? {
              adjustments: adjustments.map(
                (a) =>
                  `${a.materialNum ?? "—"} (PI ${a.piNumber}), ${a.containerLabel}: ${a.wanted} → ${a.placed}`,
              ),
            }
          : {}),
      });
    });
    await this.notify(NotificationEvent.LOAD_LIST_REJECTED, customerId, {
      comment: text,
      adjustments,
    });
    return this.readyToShip.loadView(customerId, actor.role);
  }

  /** CEAT: confirmed -> draft_ceat ("Edit load list"), e.g. for a new week. */
  async reopen(
    actor: RequestUser,
    requested?: string,
  ): Promise<ReadyToShipView> {
    const customerId = this.customer(actor, requested, Role.OPS);
    await this.dataSource.transaction(async (em) => {
      const loadList = await requireStatus(em, customerId, [
        LoadListStatus.CONFIRMED,
      ]);
      const from = loadList.status;
      await this.setStatus(em, loadList, LoadListStatus.DRAFT_CEAT, {});
      await this.journal(em, actor, customerId, "rts.load_list_reopened", {
        reason: "manual",
        from,
        to: LoadListStatus.DRAFT_CEAT,
      });
    });
    return this.readyToShip.loadView(customerId, actor.role);
  }

  /** CEAT's version against the client's: what moved where, and the fills. */
  async diff(actor: RequestUser, requested?: string): Promise<LoadListDiff> {
    const customerId = this.customer(actor, requested, Role.OPS);
    const loadList = await findOrCreateLoadList(
      this.dataSource.manager,
      customerId,
    );
    if (!loadList.clientSnapshot) {
      throw new NotFoundException(
        apiError("LOAD_LIST_NO_CLIENT_VERSION", "версии клиента нет"),
      );
    }
    return computeLoadListDiff(
      loadList.ceatSnapshot ?? emptySnapshot(),
      loadList.clientSnapshot,
    );
  }

  /** The client's version as the usual load-list sheet. */
  async clientVersionXlsx(
    actor: RequestUser,
    requested?: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const customerId = this.customer(actor, requested, Role.OPS);
    const loadList = await findOrCreateLoadList(
      this.dataSource.manager,
      customerId,
    );
    if (!loadList.clientSnapshot) {
      throw new NotFoundException(
        apiError("LOAD_LIST_NO_CLIENT_VERSION", "версии клиента нет"),
      );
    }
    const workbook = buildReadyToShipExportWorkbook(
      snapshotAsView(loadList.clientSnapshot),
    );
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      fileName: `LoadList_client_version_${formatDateForFilename(new Date())}.xlsx`,
    };
  }

  /**
   * Excel upload: ops in draft_ceat, the client in client_editing. The whole
   * file is checked first; any problem refuses it with the list per row and
   * nothing changes. Otherwise, in one transaction, the editable layout is
   * replaced by the file's (confirmed positions stay), logged as one undo
   * group — one "undo" puts the previous layout back. Ops may name numbered
   * containers that don't exist yet: they are created as manual containers,
   * but only once the upload is repeated with confirmNewContainers.
   */
  async importXlsx(
    actor: RequestUser,
    file: { buffer: Buffer; originalname: string },
    confirmNewContainers: boolean,
    requested?: string,
  ): Promise<ReadyToShipView> {
    const customerId = this.readyToShip.resolveViewCustomerId(actor, requested);
    const rows = await parseImportWorkbook(file.buffer);
    if (!rows) {
      throw new BadRequestException(
        apiError(
          "IMPORT_FILE_UNREADABLE",
          "файл не похож на выгрузку load list (нет строки заголовков Container / SKU / Proforma (PI) / SO / Quantity)",
        ),
      );
    }

    await this.dataSource.transaction(async (em) => {
      await assertEditable(em, customerId, actor);
      const containerRepo = em.getRepository(ShippingContainer);
      const allocationRepo = em.getRepository(ContainerLineAllocation);
      const containers = await containerRepo.find({
        where: { customer: { id: customerId } },
      });
      const allocations = containers.length
        ? await allocationRepo.find({
            where: { container: { id: In(containers.map((c) => c.id)) } },
            relations: ["container", "piLineItem"],
          })
        : [];
      const active = await this.readyToShip.loadActiveLines(em, customerId);
      const archived = await em.getRepository(PiLineItem).find({
        where: {
          pi: { customer: { id: customerId }, isArchivedShipped: true },
        },
        relations: ["pi"],
      });

      const plan = planImport({
        rows,
        containers: containers.map((c) => ({
          label: c.label,
          isOkToMix: c.isOkToMix ?? false,
          positions: allocations
            .filter((a) => a.container.id === c.id)
            .map((a) => ({
              lineId: a.piLineItem.id,
              qty: toNumberOrNull(a.allocatedQty) ?? 0,
              locked: a.isLocked,
            })),
        })),
        lines: active.map(({ item, dispatchQty, loadability }) => ({
          id: item.id,
          key: keyString(lineKeyOf(item)),
          piNumber: item.pi.piNumber,
          materialNum: item.materialNum,
          soNumber: item.soNumber,
          dispatchQty,
          loadability,
        })),
        archivedKeys: new Set(archived.map((l) => keyString(lineKeyOf(l)))),
        mayCreateContainers: actor.role === Role.OPS,
      });

      const manualNow = containers.filter((c) => c.isManual).length;
      if (
        plan.newContainers.length > 0 &&
        manualNow + plan.newContainers.length > MAX_MANUAL_CONTAINERS
      ) {
        plan.errors.push({
          code: "MANUAL_CONTAINER_LIMIT",
          params: { max: MAX_MANUAL_CONTAINERS },
        });
      }
      if (plan.errors.length > 0) {
        throw new BadRequestException({
          ...apiError(
            "IMPORT_INVALID",
            `файл не применён: ошибок — ${plan.errors.length}`,
            { count: plan.errors.length },
          ),
          details: plan.errors,
        });
      }
      if (plan.newContainers.length > 0 && !confirmNewContainers) {
        throw new BadRequestException({
          ...apiError(
            "IMPORT_CONFIRM_NEW_CONTAINERS",
            `будет создано новых контейнеров: ${plan.newContainers.length}`,
            {
              count: plan.newContainers.length,
              containers: plan.newContainers.map(containerParam).join(", "),
            },
          ),
        });
      }

      // New containers, OK to mix if the file uses it.
      const byLabel = new Map(containers.map((c) => [c.label, c]));
      for (const label of plan.newContainers) {
        byLabel.set(
          label,
          await containerRepo.save(
            containerRepo.create({
              customer: { id: customerId } as Customer,
              label,
              name: null,
              isOkToMix: false,
              isManual: true,
              confirmedAt: null,
              confirmedBy: null,
            }),
          ),
        );
      }
      if (plan.assignments.some((a) => a.containerLabel === OK_TO_MIX)) {
        const okToMix = await this.readyToShip.ensureOkToMix(em, customerId);
        byLabel.set(okToMix.label, okToMix);
      }

      // Out with the old editable layout, in with the file's — one undo group.
      const groupId = randomUUID();
      const now = new Date();
      const actionRepo = em.getRepository(AllocationAction);
      const { removed, added } = await replaceEditable(
        em,
        allocations.filter((a) => !a.isLocked),
        plan.assignments.map((a) => ({
          containerId: byLabel.get(a.containerLabel)!.id,
          lineId: a.lineId,
          qty: a.qty,
        })),
      );
      const entry = (containerId: string, lineId: string, delta: number) =>
        actionRepo.create({
          customer: { id: customerId } as Customer,
          container: { id: containerId } as ShippingContainer,
          piLineItem: { id: lineId } as PiLineItem,
          deltaQty: String(delta),
          groupId,
          createdAt: now,
        });
      const entries = [
        ...removed.map((a) =>
          entry(
            a.container.id,
            a.piLineItem.id,
            -(toNumberOrNull(a.allocatedQty) ?? 0),
          ),
        ),
        ...added.map((a) => entry(a.containerId, a.lineId, a.qty)),
      ];
      if (entries.length > 0) await actionRepo.save(entries);

      await this.journal(em, actor, customerId, "rts.load_list_imported", {
        fileName: file.originalname,
        rowsProcessed: plan.rowsRead,
        positions: plan.assignments.length,
        ...(plan.newContainers.length > 0
          ? {
              containersCreated: plan.newContainers.length,
              containerLabels: plan.newContainers,
            }
          : {}),
      });
    });
    return this.readyToShip.loadView(customerId, actor.role);
  }

  // ---------------------------------------------------------------------

  private customer(
    actor: RequestUser,
    requested: string | undefined,
    role: Role,
  ) {
    if (actor.role !== role && role === Role.OPS) {
      throw new ForbiddenException(
        apiError("OPS_ONLY_ACTION", "действие доступно только CEAT"),
      );
    }
    if (actor.role !== role) {
      throw new ForbiddenException(
        apiError("CLIENT_ONLY_ACTION", "Действие доступно только клиенту"),
      );
    }
    return this.readyToShip.resolveViewCustomerId(actor, requested);
  }

  /** A status change: the new status, its stamps, and no undo log from before. */
  private async setStatus(
    em: EntityManager,
    loadList: LoadList,
    status: LoadListStatus,
    fields: Partial<LoadList>,
  ): Promise<void> {
    await em
      .getRepository(LoadList)
      .update({ id: loadList.id }, { status, ...fields });
    await clearUndoLog(em, loadList.customerId);
  }

  private journal(
    em: EntityManager,
    actor: RequestUser,
    customerId: string,
    action:
      | "rts.load_list_sent"
      | "rts.load_list_accepted"
      | "rts.load_list_edit_requested"
      | "rts.load_list_submitted"
      | "rts.load_list_approved"
      | "rts.load_list_rejected"
      | "rts.load_list_reopened"
      | "rts.load_list_imported",
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(
      { actor, action, entityType: "customer", entityId: customerId, metadata },
      em,
    );
  }

  private async notify(
    event: string,
    customerId: string,
    extra: Pick<LoadListEventPayload, "comment" | "adjustments"> = {},
  ): Promise<void> {
    const customer = await this.dataSource.manager
      .getRepository(Customer)
      .findOne({ where: { id: customerId } });
    const payload: LoadListEventPayload = {
      customerId,
      customerName: customer?.name ?? "",
      ...extra,
    };
    this.eventEmitter.emit(event, payload);
  }

  /**
   * The rollback behind "reject": every editable position goes, then CEAT's
   * version's editable positions come back — matched by container label and
   * (PI, SKU, SO), cut to what the current stock still covers.
   */
  private async restoreSnapshot(
    em: EntityManager,
    customerId: string,
    snapshot: LoadListSnapshot | null,
  ): Promise<LoadListAdjustment[]> {
    const containerRepo = em.getRepository(ShippingContainer);
    const allocationRepo = em.getRepository(ContainerLineAllocation);
    const containers = await containerRepo.find({
      where: { customer: { id: customerId } },
    });
    const allocations = containers.length
      ? await allocationRepo.find({
          where: { container: { id: In(containers.map((c) => c.id)) } },
          relations: ["container", "piLineItem"],
        })
      : [];
    const editable = allocations.filter((a) => !a.isLocked);
    if (!snapshot) {
      await replaceEditable(em, editable, []);
      return [];
    }

    const lines = await this.readyToShip.loadActiveLines(em, customerId);
    const used = new Map<string, number>();
    const lockedPair = new Set<string>();
    for (const a of allocations.filter((x) => x.isLocked)) {
      used.set(
        a.piLineItem.id,
        (used.get(a.piLineItem.id) ?? 0) +
          (toNumberOrNull(a.allocatedQty) ?? 0),
      );
      lockedPair.add(`${a.container.id}#${a.piLineItem.id}`);
    }
    const byLabel = new Map(containers.map((c) => [c.label, c]));
    const adjustments: LoadListAdjustment[] = [];
    const placedPair = new Map<
      string,
      { containerId: string; lineId: string; qty: number }
    >();

    for (const sc of snapshot.containers) {
      const positions = sc.positions.filter((p) => !p.locked);
      if (positions.length === 0) continue;
      let container = byLabel.get(sc.label);
      if (!container) {
        container = sc.isOkToMix
          ? await this.readyToShip.ensureOkToMix(em, customerId)
          : await containerRepo.save(
              containerRepo.create({
                customer: { id: customerId } as Customer,
                label: sc.label,
                name: sc.name,
                isOkToMix: false,
                isManual: sc.isManual,
                confirmedAt: null,
                confirmedBy: null,
              }),
            );
        byLabel.set(sc.label, container);
      }
      for (const p of positions) {
        const key = keyString(p);
        const candidates = lines
          .filter((l) => keyString(lineKeyOf(l.item)) === key)
          .sort(
            (a, b) =>
              Number(b.item.id === p.piLineItemId) -
              Number(a.item.id === p.piLineItemId),
          );
        let left = p.qty;
        for (const { item, dispatchQty } of candidates) {
          if (left === 0) break;
          if (lockedPair.has(`${container.id}#${item.id}`)) continue;
          const free = dispatchQty - (used.get(item.id) ?? 0);
          const take = Math.min(free, left);
          if (take <= 0) continue;
          const pair = `${container.id}#${item.id}`;
          const existing = placedPair.get(pair);
          if (existing) {
            existing.qty += take;
          } else {
            placedPair.set(pair, {
              containerId: container.id,
              lineId: item.id,
              qty: take,
            });
          }
          used.set(item.id, (used.get(item.id) ?? 0) + take);
          left -= take;
        }
        if (left > 0) {
          adjustments.push({
            containerLabel: sc.label,
            piNumber: p.piNumber,
            materialNum: p.materialNum,
            soNumber: p.soNumber,
            wanted: p.qty,
            placed: p.qty - left,
          });
        }
      }
    }
    await replaceEditable(em, editable, [...placedPair.values()]);
    return adjustments;
  }

  /**
   * Does the layout as it is now still match the client's version, and does
   * the current backorder still allow it? Nobody can edit while it waits for
   * CEAT, but a backorder upload re-points positions, drops those whose line
   * is gone and changes stock and loadability.
   */
  private async verifyClientVersion(
    em: EntityManager,
    customerId: string,
    snapshot: LoadListSnapshot | null,
  ): Promise<ErrorDetail[]> {
    if (!snapshot) {
      return [{ code: "LOAD_LIST_NO_CLIENT_VERSION" }];
    }
    const containers = await em
      .getRepository(ShippingContainer)
      .find({ where: { customer: { id: customerId } } });
    const allocations = containers.length
      ? await em.getRepository(ContainerLineAllocation).find({
          where: { container: { id: In(containers.map((c) => c.id)) } },
          relations: ["container", "piLineItem", "piLineItem.pi"],
        })
      : [];
    const lines = await this.readyToShip.loadActiveLines(em, customerId);
    const activeKeys = new Set(lines.map((l) => keyString(lineKeyOf(l.item))));
    const current = new Map<string, number>();
    for (const a of allocations) {
      const k = `${a.container.label}#${keyString(lineKeyOf(a.piLineItem))}`;
      current.set(
        k,
        (current.get(k) ?? 0) + (toNumberOrNull(a.allocatedQty) ?? 0),
      );
    }
    const problems: ErrorDetail[] = [];

    const wantedByKey = new Map<string, number>();
    for (const sc of snapshot.containers) {
      for (const p of sc.positions) {
        const key = keyString(p);
        wantedByKey.set(key, (wantedByKey.get(key) ?? 0) + p.qty);
      }
    }
    const merged = new Map<
      string,
      { label: string; p: SnapshotContainer["positions"][number]; qty: number }
    >();
    for (const sc of snapshot.containers) {
      for (const p of sc.positions) {
        const k = `${sc.label}#${keyString(p)}`;
        const prev = merged.get(k);
        merged.set(k, { label: sc.label, p, qty: (prev?.qty ?? 0) + p.qty });
      }
    }
    for (const [k, { label, p, qty }] of merged) {
      const params = {
        container: containerParam(label),
        piNumber: p.piNumber,
        materialNum: p.materialNum ?? "—",
      };
      if (!activeKeys.has(keyString(p))) {
        problems.push({ code: "OUTDATED_LINE_GONE", params });
        continue;
      }
      const now = current.get(k) ?? 0;
      if (now !== qty) {
        problems.push({
          code: "OUTDATED_POSITION_CHANGED",
          params: { ...params, was: qty, now },
        });
      }
    }
    for (const [key, wanted] of wantedByKey) {
      const ofKey = lines.filter((l) => keyString(lineKeyOf(l.item)) === key);
      if (ofKey.length === 0) continue;
      const available = ofKey.reduce((sum, l) => sum + l.dispatchQty, 0);
      if (wanted > available) {
        problems.push({
          code: "OUTDATED_EXCEEDS_AVAILABLE",
          params: {
            piNumber: ofKey[0].item.pi.piNumber,
            materialNum: ofKey[0].item.materialNum ?? "—",
            wanted,
            available,
          },
        });
      }
    }
    const fill = new Map<string, number>();
    for (const a of allocations) {
      if (a.container.isOkToMix) continue;
      const loadability = toNumberOrNull(a.piLineItem.loadability);
      if (!loadability) continue;
      fill.set(
        a.container.label,
        (fill.get(a.container.label) ?? 0) +
          (toNumberOrNull(a.allocatedQty) ?? 0) / loadability,
      );
    }
    for (const [label, ratio] of fill) {
      if (isOverfilled(ratio)) {
        problems.push({
          code: "OUTDATED_CONTAINER_OVERFILLED",
          params: {
            container: containerParam(label),
            percent: toFillPercent(ratio),
          },
        });
      }
    }
    return problems;
  }
}

/**
 * Puts `wanted` in place of the editable (unlocked) positions. A position
 * that comes out the same — same container, line and quantity — is left as
 * it is, marking file included (a file stays on an unlocked position until
 * its quantity changes); every other one is replaced, and its file goes
 * with it. Returns what was actually removed and added.
 */
async function replaceEditable(
  em: EntityManager,
  editable: ContainerLineAllocation[],
  wanted: { containerId: string; lineId: string; qty: number }[],
): Promise<{
  removed: ContainerLineAllocation[];
  added: { containerId: string; lineId: string; qty: number }[];
}> {
  const allocationRepo = em.getRepository(ContainerLineAllocation);
  const pairOf = (containerId: string, lineId: string) =>
    `${containerId}#${lineId}`;
  const wantedByPair = new Map<
    string,
    { containerId: string; lineId: string; qty: number }
  >();
  for (const w of wanted) {
    const key = pairOf(w.containerId, w.lineId);
    const prev = wantedByPair.get(key);
    wantedByPair.set(key, { ...w, qty: (prev?.qty ?? 0) + w.qty });
  }
  const removed: ContainerLineAllocation[] = [];
  for (const a of editable) {
    const key = pairOf(a.container.id, a.piLineItem.id);
    const same = wantedByPair.get(key);
    if (same && (toNumberOrNull(a.allocatedQty) ?? 0) === same.qty) {
      wantedByPair.delete(key);
      continue;
    }
    removed.push(a);
  }
  if (removed.length > 0) {
    const ids = removed.map((a) => a.id);
    await em.getRepository(MarkingFile).delete({ allocation: { id: In(ids) } });
    await allocationRepo.delete({ id: In(ids) });
  }
  const added = [...wantedByPair.values()].filter((w) => w.qty > 0);
  if (added.length > 0) {
    await allocationRepo.save(
      added.map((w) =>
        allocationRepo.create({
          container: { id: w.containerId } as ShippingContainer,
          piLineItem: { id: w.lineId } as PiLineItem,
          allocatedQty: String(w.qty),
          isLocked: false,
        }),
      ),
    );
  }
  return { removed, added };
}

function emptySnapshot(): LoadListSnapshot {
  return { takenAt: "", takenBy: "", containers: [] };
}

/** Pure: CEAT's version against the client's. */
export function computeLoadListDiff(
  ceat: LoadListSnapshot,
  client: LoadListSnapshot,
): LoadListDiff {
  type Entry = {
    key: LoadListDiffLine;
    byContainer: Map<string, { ceat: number; client: number }>;
  };
  const entries = new Map<string, Entry>();
  const add = (snapshot: LoadListSnapshot, side: "ceat" | "client") => {
    for (const c of snapshot.containers) {
      for (const p of c.positions) {
        const k = keyString(p);
        const entry =
          entries.get(k) ??
          ({
            key: {
              piNumber: p.piNumber,
              materialNum: p.materialNum,
              soNumber: p.soNumber,
              materialDesc: p.materialDesc,
              changes: [],
            },
            byContainer: new Map(),
          } as Entry);
        const q = entry.byContainer.get(c.label) ?? { ceat: 0, client: 0 };
        q[side] += p.qty;
        entry.byContainer.set(c.label, q);
        entries.set(k, entry);
      }
    }
  };
  add(ceat, "ceat");
  add(client, "client");

  const lines: LoadListDiffLine[] = [];
  for (const { key, byContainer } of entries.values()) {
    const changes = [...byContainer.entries()]
      .filter(([, q]) => q.ceat !== q.client)
      .map(([label, q]) => ({
        container: label,
        ceatQty: q.ceat,
        clientQty: q.client,
      }));
    if (changes.length > 0) lines.push({ ...key, changes });
  }
  lines.sort(
    (a, b) =>
      a.piNumber.localeCompare(b.piNumber) ||
      (a.materialNum ?? "").localeCompare(b.materialNum ?? ""),
  );

  const containerInfo = new Map<string, { isOkToMix: boolean }>();
  const totals = new Map<
    string,
    { ceatQty: number; clientQty: number; ceatFill: number; clientFill: number }
  >();
  const tally = (snapshot: LoadListSnapshot, side: "ceat" | "client") => {
    for (const c of snapshot.containers) {
      containerInfo.set(c.label, { isOkToMix: c.isOkToMix });
      const t = totals.get(c.label) ?? {
        ceatQty: 0,
        clientQty: 0,
        ceatFill: 0,
        clientFill: 0,
      };
      for (const p of c.positions) {
        if (side === "ceat") {
          t.ceatQty += p.qty;
          if (p.loadability) t.ceatFill += p.qty / p.loadability;
        } else {
          t.clientQty += p.qty;
          if (p.loadability) t.clientFill += p.qty / p.loadability;
        }
      }
      totals.set(c.label, t);
    }
  };
  tally(ceat, "ceat");
  tally(client, "client");
  const numberOf = (label: string) =>
    Number(NUMBERED.exec(label)?.[1] ?? Infinity);
  const containers: LoadListDiffContainer[] = [...totals.entries()]
    .map(([label, t]) => {
      const okToMix = containerInfo.get(label)?.isOkToMix ?? false;
      return {
        label,
        isOkToMix: okToMix,
        ceatQty: t.ceatQty,
        clientQty: t.clientQty,
        ceatFillPercent: okToMix ? null : toFillPercent(t.ceatFill),
        clientFillPercent: okToMix ? null : toFillPercent(t.clientFill),
      };
    })
    .sort(
      (a, b) =>
        Number(a.isOkToMix) - Number(b.isOkToMix) ||
        numberOf(a.label) - numberOf(b.label) ||
        a.label.localeCompare(b.label),
    );
  return {
    ceatTakenAt: ceat.takenAt,
    clientTakenAt: client.takenAt,
    lines,
    containers,
  };
}

/** A snapshot shaped like the view the export builder reads. */
function snapshotAsView(
  snapshot: LoadListSnapshot,
): Parameters<typeof buildReadyToShipExportWorkbook>[0] {
  return {
    unallocatedLines: [],
    containers: snapshot.containers.map((c) => ({
      label: c.label,
      name: c.name,
      allocations: c.positions.map((p) => ({
        materialNum: p.materialNum,
        materialDesc: p.materialDesc,
        allocatedQty: p.qty,
        loadability: p.loadability,
        piNumber: p.piNumber,
        piLabel: p.piLabel,
        soNumber: p.soNumber,
        isLocked: p.locked,
      })),
    })),
  } as unknown as Parameters<typeof buildReadyToShipExportWorkbook>[0];
}
