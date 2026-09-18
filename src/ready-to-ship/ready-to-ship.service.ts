import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager, In } from "typeorm";
import { RequestUser } from "../common/auth/request-user.interface";
import { Role } from "../common/enums/role.enum";
import { isUniqueViolation } from "../common/utils/is-unique-violation";
import { toNumberOrNull } from "../common/utils/numeric";
import { Customer } from "../customers/customer.entity";
import { PiLineItem } from "../pi-line-items/pi-line-item.entity";
import { User } from "../users/user.entity";
import { AllocationAction } from "./allocation-action.entity";
import { ContainerLineAllocation } from "./container-line-allocation.entity";
import { MarkingFile } from "./marking-file.entity";
import { ShippingContainer } from "./shipping-container.entity";
import {
  AllocationView,
  ContainerView,
  ReadyToShipView,
  UnallocatedLineView,
  UnlockedContainerView,
} from "./ready-to-ship.types";
import {
  computeTotalPossibleContainers,
  fillContribution,
  isOverfilled,
  toFillPercent,
} from "./utils/compute-container-fill";

interface ActiveLine {
  item: PiLineItem;
  dispatchQty: number;
  loadability: number | null;
}

function labelNumber(label: string): number {
  const match = /(\d+)\s*$/.exec(label);
  return match ? Number(match[1]) : 0;
}

function byLabel(a: ShippingContainer, b: ShippingContainer): number {
  return (
    labelNumber(a.label) - labelNumber(b.label) ||
    a.label.localeCompare(b.label)
  );
}

function allocationKey(containerId: string, piLineItemId: string): string {
  return `${containerId}:${piLineItemId}`;
}

/**
 * "Ready to ship": a client spreads the current week's dispatch quantities
 * (PiLineItem.currentWeekDispatchQty, across all their active PI cards) over
 * container slots, confirms the plan, and CEAT can unlock single containers.
 *
 * Every write runs in one transaction and re-checks ownership here, not in
 * an interceptor — same rule as the rest of the client-facing writes (see
 * ProformaInvoicesService.findOwnedByActor). Ops reaches these handlers
 * through RolesGuard's "ops always allowed" rule, so each client-only
 * action rejects a non-client actor explicitly (see requireClient).
 */
@Injectable()
export class ReadyToShipService {
  constructor(private readonly dataSource: DataSource) {}

  async getView(
    actor: RequestUser,
    requestedCustomerId?: string,
  ): Promise<ReadyToShipView> {
    return this.loadView(
      this.resolveViewCustomerId(actor, requestedCustomerId),
    );
  }

  /**
   * Moves `qty` units of one line into one draft container. Moving into an
   * already-over-100% container is allowed on purpose — the client fixes it
   * before confirming, and confirm() is what blocks (spec: red container,
   * disabled "Confirm").
   */
  async move(
    dto: { piLineItemId: string; containerId: string; qty: number },
    actor: RequestUser,
  ): Promise<ReadyToShipView> {
    const customerId = this.requireClient(actor);
    if (!Number.isInteger(dto.qty) || dto.qty <= 0) {
      throw new BadRequestException(
        "количество указывается в целых штуках и должно быть больше нуля",
      );
    }

    await this.dataSource.transaction(async (em) => {
      const lineRepo = em.getRepository(PiLineItem);
      const allocationRepo = em.getRepository(ContainerLineAllocation);

      const line = await lineRepo.findOne({
        where: { id: dto.piLineItemId },
        relations: ["pi", "pi.customer"],
      });
      if (!line || line.pi.customer.id !== customerId) {
        throw new NotFoundException(`PiLineItem ${dto.piLineItemId} not found`);
      }
      const container = await this.findOwnedContainer(
        em,
        dto.containerId,
        customerId,
      );
      if (container.isConfirmed) {
        throw new BadRequestException(
          "контейнер подтверждён — состав можно менять только после разблокировки CEAT",
        );
      }
      if (line.pi.isArchivedShipped) {
        throw new BadRequestException(
          "строка не входит в список готового к отгрузке",
        );
      }
      const loadability = toNumberOrNull(line.loadability);
      if (!loadability || loadability <= 0) {
        throw new BadRequestException(
          "у строки не задана loadability — распределить её по контейнерам нельзя",
        );
      }

      // Row lock so a double-clicked "move" can't pass the remaining-qty
      // check twice against the same not-yet-updated allocations.
      await lineRepo.findOne({
        where: { id: line.id },
        lock: { mode: "pessimistic_write" },
      });

      const allocatedElsewhere = (
        await allocationRepo.find({ where: { piLineItem: { id: line.id } } })
      ).reduce((sum, a) => sum + (toNumberOrNull(a.allocatedQty) ?? 0), 0);
      const remaining =
        (toNumberOrNull(line.currentWeekDispatchQty) ?? 0) - allocatedElsewhere;
      if (dto.qty > remaining) {
        throw new BadRequestException(
          `нельзя переместить ${dto.qty}: нераспределённый остаток строки — ${Math.max(0, remaining)}`,
        );
      }

      const existing = await allocationRepo.findOne({
        where: { container: { id: container.id }, piLineItem: { id: line.id } },
      });
      if (existing) {
        await this.setAllocatedQty(
          em,
          existing,
          (toNumberOrNull(existing.allocatedQty) ?? 0) + dto.qty,
        );
      } else {
        await allocationRepo.save(
          allocationRepo.create({
            container: { id: container.id } as ShippingContainer,
            piLineItem: { id: line.id } as PiLineItem,
            allocatedQty: String(dto.qty),
          }),
        );
      }

      const actionRepo = em.getRepository(AllocationAction);
      await actionRepo.save(
        actionRepo.create({
          customer: { id: customerId } as Customer,
          container: { id: container.id } as ShippingContainer,
          piLineItem: { id: line.id } as PiLineItem,
          deltaQty: String(dto.qty),
          createdAt: new Date(),
        }),
      );
    });

    return this.loadView(customerId);
  }

  /** Rolls back the newest move among this client's not-confirmed containers. */
  async undoLast(actor: RequestUser): Promise<ReadyToShipView> {
    const customerId = this.requireClient(actor);

    await this.dataSource.transaction(async (em) => {
      const draftIds = await this.findDraftContainerIds(em, customerId);
      const [last] = draftIds.length
        ? await em.getRepository(AllocationAction).find({
            where: { container: { id: In(draftIds) } },
            relations: ["container", "piLineItem"],
            order: { createdAt: "DESC" },
            take: 1,
          })
        : [];
      if (!last) {
        throw new NotFoundException("нет действий для отмены");
      }

      const allocation = await em
        .getRepository(ContainerLineAllocation)
        .findOne({
          where: {
            container: { id: last.container.id },
            piLineItem: { id: last.piLineItem.id },
          },
        });
      if (allocation) {
        await this.reduceAllocation(
          em,
          allocation,
          toNumberOrNull(last.deltaQty) ?? 0,
        );
      }
      await em.getRepository(AllocationAction).delete({ id: last.id });
    });

    return this.loadView(customerId);
  }

  /**
   * Rolls back every move on this client's not-confirmed containers
   * (drafts and unlocked ones), drops the containers that end up empty and
   * recreates slots so the client again sees the full set. Confirmed
   * containers are never touched, and count toward the slot total — the
   * total is "how many containers this dispatch needs", not "how many empty
   * drafts to show".
   */
  async undoAll(actor: RequestUser): Promise<ReadyToShipView> {
    const customerId = this.requireClient(actor);

    await this.dataSource.transaction(async (em) => {
      const containerRepo = em.getRepository(ShippingContainer);
      const allocationRepo = em.getRepository(ContainerLineAllocation);
      const actionRepo = em.getRepository(AllocationAction);

      const containers = await containerRepo.find({
        where: { customer: { id: customerId } },
      });
      const drafts = containers.filter((c) => !c.isConfirmed);
      const draftIds = drafts.map((c) => c.id);

      if (draftIds.length) {
        const actions = await actionRepo.find({
          where: { container: { id: In(draftIds) } },
          relations: ["container", "piLineItem"],
        });
        const rollbackByAllocation = new Map<string, number>();
        for (const action of actions) {
          const key = allocationKey(action.container.id, action.piLineItem.id);
          rollbackByAllocation.set(
            key,
            (rollbackByAllocation.get(key) ?? 0) +
              (toNumberOrNull(action.deltaQty) ?? 0),
          );
        }

        const allocations = await allocationRepo.find({
          where: { container: { id: In(draftIds) } },
          relations: ["container", "piLineItem"],
        });
        for (const allocation of allocations) {
          const rollback = rollbackByAllocation.get(
            allocationKey(allocation.container.id, allocation.piLineItem.id),
          );
          if (rollback) {
            await this.reduceAllocation(em, allocation, rollback);
          }
        }
        if (actions.length) {
          await actionRepo.delete({ id: In(actions.map((a) => a.id)) });
        }
      }

      const stillFilled = draftIds.length
        ? await allocationRepo.find({
            where: { container: { id: In(draftIds) } },
            relations: ["container"],
          })
        : [];
      const filledIds = new Set(stillFilled.map((a) => a.container.id));
      const emptyDrafts = drafts.filter((c) => !filledIds.has(c.id));
      if (emptyDrafts.length) {
        await containerRepo.delete({ id: In(emptyDrafts.map((c) => c.id)) });
      }
      const kept = containers.filter((c) => !emptyDrafts.includes(c));

      const total = computeTotalPossibleContainers(
        await this.loadActiveLines(em, customerId),
      );
      await this.createEmptyContainers(
        em,
        customerId,
        total - kept.length,
        kept,
      );
    });

    return this.loadView(customerId);
  }

  /**
   * One action for the whole session: every not-confirmed container that
   * holds at least one allocation gets confirmed together, or none do. A
   * single save() of the whole set is one transaction, so a failure can't
   * leave half of them confirmed.
   */
  async confirm(actor: RequestUser): Promise<ReadyToShipView> {
    const customerId = this.requireClient(actor);

    await this.dataSource.transaction(async (em) => {
      const containerRepo = em.getRepository(ShippingContainer);
      const drafts = (
        await containerRepo.find({ where: { customer: { id: customerId } } })
      ).filter((c) => !c.isConfirmed);

      const allocations = drafts.length
        ? await em.getRepository(ContainerLineAllocation).find({
            where: { container: { id: In(drafts.map((c) => c.id)) } },
            relations: ["container", "piLineItem"],
          })
        : [];
      const fillByContainer = this.sumFillByContainer(allocations);
      const toConfirm = drafts
        .filter((c) => fillByContainer.has(c.id))
        .sort(byLabel);

      if (toConfirm.length === 0) {
        throw new BadRequestException(
          "нет контейнеров с позициями для подтверждения",
        );
      }

      const overfilled = toConfirm.filter((c) =>
        isOverfilled(fillByContainer.get(c.id) ?? 0),
      );
      if (overfilled.length > 0) {
        throw new BadRequestException({
          statusCode: 400,
          error: "Bad Request",
          message: `перегружены контейнеры: ${overfilled
            .map(
              (c) =>
                `${c.label} (${toFillPercent(fillByContainer.get(c.id) ?? 0)}%)`,
            )
            .join(", ")}`,
          overfilledContainers: overfilled.map((c) => ({
            id: c.id,
            label: c.label,
            fillPercent: toFillPercent(fillByContainer.get(c.id) ?? 0),
          })),
        });
      }

      const now = new Date();
      for (const container of toConfirm) {
        container.isConfirmed = true;
        container.confirmedAt = now;
        container.confirmedBy = { id: actor.id } as User;
      }
      await containerRepo.save(toConfirm);
    });

    return this.loadView(customerId);
  }

  /**
   * Ops-only, one container at a time. Marking files are left alone here —
   * they're dropped later, per allocation row, the moment that row's
   * quantity actually changes (see setAllocatedQty / reduceAllocation).
   */
  async unlock(
    containerId: string,
    actor: RequestUser,
  ): Promise<UnlockedContainerView> {
    if (actor.role !== Role.OPS) {
      throw new ForbiddenException(
        "Разблокировка контейнера доступна только CEAT",
      );
    }

    const containerRepo =
      this.dataSource.manager.getRepository(ShippingContainer);
    const container = await containerRepo.findOne({
      where: { id: containerId },
      relations: ["customer"],
    });
    if (!container) {
      throw new NotFoundException(`ShippingContainer ${containerId} not found`);
    }
    if (!container.isConfirmed) {
      throw new BadRequestException(
        "контейнер не подтверждён — разблокировать нечего",
      );
    }

    container.isConfirmed = false;
    container.confirmedAt = null;
    container.confirmedBy = null;
    await containerRepo.save(container);

    return {
      id: container.id,
      label: container.label,
      customerId: container.customer.id,
      isConfirmed: false,
    };
  }

  private requireClient(actor: RequestUser): string {
    if (actor.role !== Role.CLIENT || !actor.customerId) {
      throw new ForbiddenException("Действие доступно только клиенту");
    }
    return actor.customerId;
  }

  private resolveViewCustomerId(
    actor: RequestUser,
    requested?: string,
  ): string {
    if (actor.role === Role.CLIENT) {
      if (!actor.customerId) {
        throw new ForbiddenException("Пользователь не привязан к клиенту");
      }
      if (requested && requested !== actor.customerId) {
        throw new NotFoundException("Customer not found");
      }
      return actor.customerId;
    }
    if (!requested) {
      throw new BadRequestException("customerId обязателен");
    }
    return requested;
  }

  private async findOwnedContainer(
    em: EntityManager,
    containerId: string,
    customerId: string,
  ): Promise<ShippingContainer> {
    const container = await em.getRepository(ShippingContainer).findOne({
      where: { id: containerId },
      relations: ["customer"],
    });
    if (!container || container.customer.id !== customerId) {
      throw new NotFoundException(`ShippingContainer ${containerId} not found`);
    }
    return container;
  }

  private async findDraftContainerIds(
    em: EntityManager,
    customerId: string,
  ): Promise<string[]> {
    const containers = await em
      .getRepository(ShippingContainer)
      .find({ where: { customer: { id: customerId } } });
    return containers.filter((c) => !c.isConfirmed).map((c) => c.id);
  }

  /** Any change to an existing row's quantity invalidates its marking file. */
  private async setAllocatedQty(
    em: EntityManager,
    allocation: ContainerLineAllocation,
    newQty: number,
  ): Promise<void> {
    await em
      .getRepository(MarkingFile)
      .delete({ allocation: { id: allocation.id } });
    allocation.allocatedQty = String(newQty);
    await em.getRepository(ContainerLineAllocation).save(allocation);
  }

  private async reduceAllocation(
    em: EntityManager,
    allocation: ContainerLineAllocation,
    byQty: number,
  ): Promise<void> {
    const left = (toNumberOrNull(allocation.allocatedQty) ?? 0) - byQty;
    if (left > 0) {
      await this.setAllocatedQty(em, allocation, left);
      return;
    }
    await em
      .getRepository(MarkingFile)
      .delete({ allocation: { id: allocation.id } });
    await em
      .getRepository(ContainerLineAllocation)
      .delete({ id: allocation.id });
  }

  private sumFillByContainer(
    allocations: ContainerLineAllocation[],
  ): Map<string, number> {
    const fill = new Map<string, number>();
    for (const allocation of allocations) {
      fill.set(
        allocation.container.id,
        (fill.get(allocation.container.id) ?? 0) +
          fillContribution(
            toNumberOrNull(allocation.allocatedQty) ?? 0,
            toNumberOrNull(allocation.piLineItem.loadability),
          ),
      );
    }
    return fill;
  }

  private async loadActiveLines(
    em: EntityManager,
    customerId: string,
  ): Promise<ActiveLine[]> {
    const items = await em.getRepository(PiLineItem).find({
      where: { pi: { customer: { id: customerId }, isArchivedShipped: false } },
      relations: ["pi"],
    });
    return items
      .map((item) => ({
        item,
        dispatchQty: toNumberOrNull(item.currentWeekDispatchQty) ?? 0,
        loadability: toNumberOrNull(item.loadability),
      }))
      .filter((line) => line.dispatchQty > 0);
  }

  private async createEmptyContainers(
    em: EntityManager,
    customerId: string,
    count: number,
    existing: ShippingContainer[],
  ): Promise<void> {
    if (count <= 0) {
      return;
    }
    let next =
      existing.reduce((max, c) => Math.max(max, labelNumber(c.label)), 0) + 1;
    const repo = em.getRepository(ShippingContainer);
    const fresh = Array.from({ length: count }, () =>
      repo.create({
        customer: { id: customerId } as Customer,
        label: `Контейнер ${next++}`,
        isConfirmed: false,
        confirmedAt: null,
        confirmedBy: null,
      }),
    );
    await repo.save(fresh);
  }

  /**
   * Keeps at least `total` container slots in existence, on every read:
   * the first visit creates all of them, and when a later backorder upload
   * raises the need (totalPossibleContainers) only the missing ones are
   * added. Purely additive — containers are never removed here, so a plan
   * that shrinks leaves its spare empty slots alone, and confirmed and
   * half-filled containers count toward the total like any other.
   *
   * Two concurrent reads that both find slots missing both try to create the
   * same new labels; the (customer_id, label) unique constraint makes the
   * loser fail, which is swallowed here — the winner's containers are what
   * both then read.
   */
  private async ensureContainerSlots(
    customerId: string,
    total: number,
  ): Promise<void> {
    if (total <= 0) {
      return;
    }
    try {
      await this.dataSource.transaction(async (em) => {
        const existing = await em
          .getRepository(ShippingContainer)
          .find({ where: { customer: { id: customerId } } });
        await this.createEmptyContainers(
          em,
          customerId,
          total - existing.length,
          existing,
        );
      });
    } catch (err) {
      if (!isUniqueViolation(err)) {
        throw err;
      }
    }
  }

  private async loadView(customerId: string): Promise<ReadyToShipView> {
    const em = this.dataSource.manager;
    const lines = await this.loadActiveLines(em, customerId);
    const totalPossibleContainers = computeTotalPossibleContainers(lines);
    await this.ensureContainerSlots(customerId, totalPossibleContainers);

    const containers = (
      await em.getRepository(ShippingContainer).find({
        where: { customer: { id: customerId } },
        relations: ["confirmedBy"],
      })
    ).sort(byLabel);
    const containerIds = containers.map((c) => c.id);

    const allocations = containerIds.length
      ? await em.getRepository(ContainerLineAllocation).find({
          where: { container: { id: In(containerIds) } },
          relations: ["container", "piLineItem", "piLineItem.pi"],
        })
      : [];
    const markings = allocations.length
      ? await em.getRepository(MarkingFile).find({
          where: { allocation: { id: In(allocations.map((a) => a.id)) } },
          relations: ["allocation"],
        })
      : [];
    const markingByAllocation = new Map(
      markings.map((m) => [m.allocation.id, m]),
    );

    const allocatedByLine = new Map<string, number>();
    const allocationsByContainer = new Map<string, ContainerLineAllocation[]>();
    for (const allocation of allocations) {
      const qty = toNumberOrNull(allocation.allocatedQty) ?? 0;
      allocatedByLine.set(
        allocation.piLineItem.id,
        (allocatedByLine.get(allocation.piLineItem.id) ?? 0) + qty,
      );
      const group = allocationsByContainer.get(allocation.container.id) ?? [];
      group.push(allocation);
      allocationsByContainer.set(allocation.container.id, group);
    }

    const unallocatedLines: UnallocatedLineView[] = lines
      .map(({ item, dispatchQty, loadability }) => {
        const allocatedQty = allocatedByLine.get(item.id) ?? 0;
        return {
          piLineItemId: item.id,
          piId: item.pi.id,
          piNumber: item.pi.piNumber,
          soNumber: item.soNumber,
          materialNum: item.materialNum,
          materialDesc: item.materialDesc,
          loadability,
          currentWeekDispatchQty: dispatchQty,
          allocatedQty,
          remainingQty: Math.max(0, dispatchQty - allocatedQty),
        };
      })
      .filter((line) => line.remainingQty > 0)
      .sort(byLineOrder);

    const containerViews: ContainerView[] = containers.map((container) => {
      const allocationViews = (allocationsByContainer.get(container.id) ?? [])
        .map((allocation): AllocationView => {
          const line = allocation.piLineItem;
          const loadability = toNumberOrNull(line.loadability);
          const allocatedQty = toNumberOrNull(allocation.allocatedQty) ?? 0;
          const marking = markingByAllocation.get(allocation.id);
          return {
            id: allocation.id,
            piLineItemId: line.id,
            piId: line.pi.id,
            piNumber: line.pi.piNumber,
            soNumber: line.soNumber,
            materialNum: line.materialNum,
            materialDesc: line.materialDesc,
            loadability,
            allocatedQty,
            fillContribution: fillContribution(allocatedQty, loadability),
            markingFile: marking
              ? { id: marking.id, uploadedAt: marking.uploadedAt }
              : null,
          };
        })
        .sort(byLineOrder);
      const fillRatio = allocationViews.reduce(
        (sum, a) => sum + a.fillContribution,
        0,
      );
      return {
        id: container.id,
        label: container.label,
        isConfirmed: container.isConfirmed,
        confirmedAt: container.confirmedAt,
        confirmedById: container.confirmedBy?.id ?? null,
        fillPercent: toFillPercent(fillRatio),
        isOverfilled: isOverfilled(fillRatio),
        markingFilesUploaded: allocationViews.filter((a) => a.markingFile)
          .length,
        markingFilesTotal: allocationViews.length,
        allocations: allocationViews,
      };
    });

    const drafts = containerViews.filter(
      (c) => !c.isConfirmed && c.allocations.length > 0,
    );
    return {
      customerId,
      totalPossibleContainers,
      canConfirm: drafts.length > 0 && drafts.every((c) => !c.isOverfilled),
      unallocatedLines,
      containers: containerViews,
    };
  }
}

function byLineOrder(
  a: { piNumber: string; materialNum: string | null; soNumber: string | null },
  b: { piNumber: string; materialNum: string | null; soNumber: string | null },
): number {
  return (
    a.piNumber.localeCompare(b.piNumber) ||
    (a.materialNum ?? "").localeCompare(b.materialNum ?? "") ||
    (a.soNumber ?? "").localeCompare(b.soNumber ?? "")
  );
}
