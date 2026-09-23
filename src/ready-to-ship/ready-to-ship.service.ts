import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager, In } from "typeorm";
import { RequestUser } from "../common/auth/request-user.interface";
import { apiError } from "../common/errors/api-error";
import { Role } from "../common/enums/role.enum";
import { formatDateForFilename } from "../common/utils/format-date";
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
  UnlockedAllocationView,
  UnlockedContainerView,
} from "./ready-to-ship.types";
import { buildReadyToShipExportWorkbook } from "./utils/build-ready-to-ship-export-workbook";
import {
  computeTotalPossibleContainers,
  fillContribution,
  isOverfilled,
  toFillPercent,
} from "./utils/compute-container-fill";
import { NotificationEvent } from "../notifications/notification-events";

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
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getView(
    actor: RequestUser,
    requestedCustomerId?: string,
  ): Promise<ReadyToShipView> {
    return this.loadView(
      this.resolveViewCustomerId(actor, requestedCustomerId),
    );
  }

  /**
   * The whole picture as one flat sheet (see buildReadyToShipExportRows).
   * Built from the same view the screen shows, so scoping is the view's:
   * client -> own customer, ops must name one.
   */
  async exportXlsx(
    actor: RequestUser,
    requestedCustomerId?: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const view = await this.getView(actor, requestedCustomerId);
    const arrayBuffer =
      await buildReadyToShipExportWorkbook(view).xlsx.writeBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      fileName: `ReadyToShip_${formatDateForFilename(new Date())}.xlsx`,
    };
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
        apiError(
          "QTY_NOT_POSITIVE_INTEGER",
          "количество указывается в целых штуках и должно быть больше нуля",
        ),
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
        throw new NotFoundException(
          apiError("NOT_FOUND", `PiLineItem ${dto.piLineItemId} not found`),
        );
      }
      const container = await this.findOwnedContainer(
        em,
        dto.containerId,
        customerId,
      );
      if (line.pi.isArchivedShipped) {
        throw new BadRequestException(
          apiError(
            "LINE_NOT_READY_TO_SHIP",
            "строка не входит в список готового к отгрузке",
          ),
        );
      }
      const loadability = toNumberOrNull(line.loadability);
      if (!loadability || loadability <= 0) {
        throw new BadRequestException(
          apiError(
            "LINE_NO_LOADABILITY",
            "у строки не задана loadability — распределить её по контейнерам нельзя",
          ),
        );
      }

      // Row lock so a double-clicked "move" can't pass the remaining-qty
      // check twice against the same not-yet-updated allocations.
      await lineRepo.findOne({
        where: { id: line.id },
        lock: { mode: "pessimistic_write" },
      });

      // One read serves both the remaining-qty check and the upsert below
      // (every round trip inside the transaction is ~100 ms to Neon).
      const lineAllocations = await allocationRepo.find({
        where: { piLineItem: { id: line.id } },
        relations: ["container"],
      });
      const allocatedElsewhere = lineAllocations.reduce(
        (sum, a) => sum + (toNumberOrNull(a.allocatedQty) ?? 0),
        0,
      );
      const remaining =
        (toNumberOrNull(line.currentWeekDispatchQty) ?? 0) - allocatedElsewhere;
      if (dto.qty > remaining) {
        throw new BadRequestException(
          apiError(
            "MOVE_EXCEEDS_REMAINING",
            `нельзя переместить ${dto.qty}: нераспределённый остаток строки — ${Math.max(0, remaining)}`,
            { qty: dto.qty, remaining: Math.max(0, remaining) },
          ),
        );
      }

      const existing = lineAllocations.find(
        (a) => a.container.id === container.id,
      );
      if (existing) {
        // This exact position may be locked even while the rest of the
        // container isn't (Phase 16: partial unlock) — check the position
        // itself, not the container as a whole.
        if (existing.isLocked) {
          throw new BadRequestException(
            apiError(
              "ALLOCATION_LOCKED",
              "позиция заблокирована — состав можно менять только после разблокировки CEAT",
            ),
          );
        }
        await this.setAllocatedQty(
          em,
          existing,
          (toNumberOrNull(existing.allocatedQty) ?? 0) + dto.qty,
        );
      } else {
        // No position here yet for this line: blocked only if the container
        // is fully locked (every position on it confirmed) — a partially
        // unlocked or still-empty container accepts a brand new one.
        const containerAllocations = await allocationRepo.find({
          where: { container: { id: container.id } },
        });
        const isContainerFullyLocked =
          containerAllocations.length > 0 &&
          containerAllocations.every((a) => a.isLocked);
        if (isContainerFullyLocked) {
          throw new BadRequestException(
            apiError(
              "CONTAINER_LOCKED",
              "контейнер подтверждён — состав можно менять только после разблокировки CEAT",
            ),
          );
        }
        await allocationRepo.save(
          allocationRepo.create({
            container: { id: container.id } as ShippingContainer,
            piLineItem: { id: line.id } as PiLineItem,
            allocatedQty: String(dto.qty),
            isLocked: false,
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

  /**
   * Takes `qty` units of one allocation back out of a draft container (all of
   * them deletes the row) and returns them to the unallocated list. Logged as
   * a negative action, so "undo last" can put it back and the actions of a
   * container keep summing to its allocations' quantities. Changing the
   * quantity drops that row's marking file, like any other change.
   */
  async remove(
    dto: { allocationId: string; qty: number },
    actor: RequestUser,
  ): Promise<ReadyToShipView> {
    const customerId = this.requireClient(actor);
    if (!Number.isInteger(dto.qty) || dto.qty <= 0) {
      throw new BadRequestException(
        apiError(
          "QTY_NOT_POSITIVE_INTEGER",
          "количество указывается в целых штуках и должно быть больше нуля",
        ),
      );
    }

    await this.dataSource.transaction(async (em) => {
      const allocationRepo = em.getRepository(ContainerLineAllocation);
      const found = await allocationRepo.findOne({
        where: { id: dto.allocationId },
        relations: ["container", "container.customer", "piLineItem"],
      });
      if (!found || found.container.customer.id !== customerId) {
        throw new NotFoundException(
          apiError(
            "NOT_FOUND",
            `ContainerLineAllocation ${dto.allocationId} not found`,
          ),
        );
      }
      if (found.isLocked) {
        throw new BadRequestException(
          apiError(
            "ALLOCATION_LOCKED",
            "позиция заблокирована — состав можно менять только после разблокировки CEAT",
          ),
        );
      }

      // Re-read under a row lock so two quick "remove" clicks can't take out
      // more than is there.
      const allocation = await allocationRepo.findOne({
        where: { id: found.id },
        lock: { mode: "pessimistic_write" },
      });
      const current = toNumberOrNull(allocation?.allocatedQty) ?? 0;
      if (!allocation || dto.qty > current) {
        throw new BadRequestException(
          apiError(
            "REMOVE_EXCEEDS_ALLOCATED",
            `нельзя убрать ${dto.qty}: в контейнере ${current}`,
            { qty: dto.qty, current },
          ),
        );
      }

      await this.reduceAllocation(em, allocation, dto.qty);

      const actionRepo = em.getRepository(AllocationAction);
      await actionRepo.save(
        actionRepo.create({
          customer: { id: customerId } as Customer,
          container: { id: found.container.id } as ShippingContainer,
          piLineItem: { id: found.piLineItem.id } as PiLineItem,
          deltaQty: String(-dto.qty),
          createdAt: new Date(),
        }),
      );
    });

    return this.loadView(customerId);
  }

  /** Rolls back the newest move among this client's currently-unlocked positions. */
  async undoLast(actor: RequestUser): Promise<ReadyToShipView> {
    const customerId = this.requireClient(actor);

    await this.dataSource.transaction(async (em) => {
      const containers = await em
        .getRepository(ShippingContainer)
        .find({ where: { customer: { id: customerId } } });
      const containerIds = containers.map((c) => c.id);
      const lockedKeys = await this.findLockedAllocationKeys(em, customerId);
      const candidates = containerIds.length
        ? await em.getRepository(AllocationAction).find({
            where: { container: { id: In(containerIds) } },
            relations: ["container", "piLineItem"],
            order: { createdAt: "DESC" },
          })
        : [];
      // A container can now be a mix of locked and unlocked positions —
      // only an action whose own position isn't locked is undoable. This
      // also covers a position that was moved in and then fully removed
      // again (no allocation row left at all): it's simply absent from
      // lockedKeys, same as one that's still there and unlocked.
      const last = candidates.find(
        (a) => !lockedKeys.has(allocationKey(a.container.id, a.piLineItem.id)),
      );
      if (!last) {
        throw new NotFoundException(
          apiError("NOTHING_TO_UNDO", "нет действий для отмены"),
        );
      }

      const delta = toNumberOrNull(last.deltaQty) ?? 0;
      if (delta < 0) {
        await this.restoreRemoved(em, last, -delta);
      } else {
        const allocation = await em
          .getRepository(ContainerLineAllocation)
          .findOne({
            where: {
              container: { id: last.container.id },
              piLineItem: { id: last.piLineItem.id },
            },
          });
        if (allocation) {
          await this.reduceAllocation(em, allocation, delta);
        }
      }
      await em.getRepository(AllocationAction).delete({ id: last.id });
    });

    return this.loadView(customerId);
  }

  /**
   * Rolls back every move on this client's currently-unlocked positions,
   * drops the containers that end up with nothing left at all, and
   * recreates slots so the client again sees the full set. A locked
   * position is never touched, even sitting right next to an unlocked one
   * in the same partially-unlocked container (Phase 16) — and a container
   * keeps its slot, un-recycled, as long as even one locked position of its
   * survives the rollback. Confirmed containers still count toward the slot
   * total either way — the total is "how many containers this dispatch
   * needs", not "how many empty drafts to show".
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
      const containerIds = containers.map((c) => c.id);
      const allAllocations = containerIds.length
        ? await allocationRepo.find({
            where: { container: { id: In(containerIds) } },
            relations: ["container", "piLineItem"],
          })
        : [];
      const lockedKeys = new Set(
        allAllocations
          .filter((a) => a.isLocked)
          .map((a) => allocationKey(a.container.id, a.piLineItem.id)),
      );
      // Positions this rollback may touch: existing unlocked allocation rows
      // *plus* ones already removed entirely (no row, so not in lockedKeys
      // either) — reduceAllocation only ever runs against a row that's
      // actually there, so the "already gone" case just needs no action.
      const unlockedAllocations = allAllocations.filter((a) => !a.isLocked);

      if (containerIds.length) {
        const actions = await actionRepo.find({
          where: { container: { id: In(containerIds) } },
          relations: ["container", "piLineItem"],
        });
        const relevantActions = actions.filter(
          (a) =>
            !lockedKeys.has(allocationKey(a.container.id, a.piLineItem.id)),
        );
        const rollbackByAllocation = new Map<string, number>();
        for (const action of relevantActions) {
          const key = allocationKey(action.container.id, action.piLineItem.id);
          rollbackByAllocation.set(
            key,
            (rollbackByAllocation.get(key) ?? 0) +
              (toNumberOrNull(action.deltaQty) ?? 0),
          );
        }

        for (const allocation of unlockedAllocations) {
          const rollback = rollbackByAllocation.get(
            allocationKey(allocation.container.id, allocation.piLineItem.id),
          );
          // The log nets out to the allocation's quantity (moves add, removes
          // subtract); a non-positive net means nothing of it came from this
          // log, so there is nothing to roll back.
          if (rollback && rollback > 0) {
            await this.reduceAllocation(em, allocation, rollback);
          }
        }
        if (relevantActions.length) {
          await actionRepo.delete({ id: In(relevantActions.map((a) => a.id)) });
        }
      }

      // Recycle a container's slot only if it now has nothing locked on it
      // at all — the same "pure draft" set the old whole-container model
      // used, generalized to per-position locking: a container with even
      // one locked (or partially-unlocked) position is never a deletion
      // candidate, regardless of what just happened to its other positions.
      const lockedContainerIds = new Set(
        allAllocations.filter((a) => a.isLocked).map((a) => a.container.id),
      );
      const pureDraftContainers = containers.filter(
        (c) => !lockedContainerIds.has(c.id),
      );
      const pureDraftIds = pureDraftContainers.map((c) => c.id);
      const stillFilled = pureDraftIds.length
        ? await allocationRepo.find({
            where: { container: { id: In(pureDraftIds) } },
            relations: ["container"],
          })
        : [];
      const filledIds = new Set(stillFilled.map((a) => a.container.id));
      const emptyContainers = pureDraftContainers.filter(
        (c) => !filledIds.has(c.id),
      );
      if (emptyContainers.length) {
        await containerRepo.delete({
          id: In(emptyContainers.map((c) => c.id)),
        });
      }
      const kept = containers.filter((c) => !emptyContainers.includes(c));

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
   * One action for the whole session: every currently-unlocked position
   * across every one of this customer's containers gets locked together, or
   * none do. A container "touched" by this (i.e. it has at least one
   * unlocked position, whether that's a plain draft or one line reopened by
   * ops — Phase 16) has *all* of its positions locked, including ones that
   * were already locked before this call — reusing this one bulk action for
   * both "confirm a fresh plan" and "re-confirm after a partial unlock" is
   * exactly what the roadmap asked for, and it falls out naturally here
   * rather than needing its own code path. A single save() of the whole set
   * is one transaction, so a failure can't leave half of them confirmed.
   */
  async confirm(actor: RequestUser): Promise<ReadyToShipView> {
    const customerId = this.requireClient(actor);

    await this.dataSource.transaction(async (em) => {
      const containerRepo = em.getRepository(ShippingContainer);
      const allocationRepo = em.getRepository(ContainerLineAllocation);
      const containers = await containerRepo.find({
        where: { customer: { id: customerId } },
      });
      const containerIds = containers.map((c) => c.id);
      const allocations = containerIds.length
        ? await allocationRepo.find({
            where: { container: { id: In(containerIds) } },
            relations: ["container", "piLineItem"],
          })
        : [];

      const touchedContainerIds = new Set(
        allocations.filter((a) => !a.isLocked).map((a) => a.container.id),
      );
      const toConfirm = containers
        .filter((c) => touchedContainerIds.has(c.id))
        .sort(byLabel);

      if (toConfirm.length === 0) {
        throw new BadRequestException(
          apiError(
            "NOTHING_TO_CONFIRM",
            "нет контейнеров с незафиксированными позициями для подтверждения",
          ),
        );
      }

      // The overfill check is against the *whole* container (locked and
      // unlocked positions together) — a physical container doesn't care
      // which of its rows happen to be editable right now.
      const touchedAllocations = allocations.filter((a) =>
        touchedContainerIds.has(a.container.id),
      );
      const fillByContainer = this.sumFillByContainer(touchedAllocations);
      const overfilled = toConfirm.filter((c) =>
        isOverfilled(fillByContainer.get(c.id) ?? 0),
      );
      if (overfilled.length > 0) {
        const percentOf = (c: ShippingContainer) =>
          toFillPercent(fillByContainer.get(c.id) ?? 0);
        throw new BadRequestException({
          ...apiError(
            "CONTAINER_OVERFILLED",
            `перегружены контейнеры: ${overfilled
              .map((c) => `${c.label} (${percentOf(c)}%)`)
              .join(", ")}`,
            // Slot labels are stored in Russian ("Контейнер N"), so the
            // translatable param carries only numbers: "#1 (105%), #3 (112%)".
            {
              containers: overfilled
                .map((c) => `#${labelNumber(c.label)} (${percentOf(c)}%)`)
                .join(", "),
            },
          ),
          overfilledContainers: overfilled.map((c) => ({
            id: c.id,
            label: c.label,
            fillPercent: toFillPercent(fillByContainer.get(c.id) ?? 0),
          })),
        });
      }

      for (const allocation of touchedAllocations) {
        allocation.isLocked = true;
      }
      await allocationRepo.save(touchedAllocations);

      const now = new Date();
      for (const container of toConfirm) {
        container.confirmedAt = now;
        container.confirmedBy = { id: actor.id } as User;
      }
      await containerRepo.save(toConfirm);
    });

    return this.loadView(customerId);
  }

  /**
   * Ops-only, one container at a time — locks/unlocks every position on it
   * together. `unlockAllocation` below is the finer-grained Phase 16
   * sibling, for freeing a single position without touching the rest of the
   * container; this stays as the blunter option next to it. Marking files
   * are left alone here — they're dropped later, per allocation row, the
   * moment that row's quantity actually changes (see setAllocatedQty /
   * reduceAllocation).
   */
  async unlock(
    containerId: string,
    actor: RequestUser,
  ): Promise<UnlockedContainerView> {
    if (actor.role !== Role.OPS) {
      throw new ForbiddenException(
        apiError(
          "OPS_ONLY_ACTION",
          "Разблокировка контейнера доступна только CEAT",
        ),
      );
    }

    const containerRepo =
      this.dataSource.manager.getRepository(ShippingContainer);
    const allocationRepo = this.dataSource.manager.getRepository(
      ContainerLineAllocation,
    );
    const container = await containerRepo.findOne({
      where: { id: containerId },
      relations: ["customer"],
    });
    if (!container) {
      throw new NotFoundException(
        apiError("NOT_FOUND", `ShippingContainer ${containerId} not found`),
      );
    }
    const allocations = await allocationRepo.find({
      where: { container: { id: containerId } },
    });
    const locked = allocations.filter((a) => a.isLocked);
    if (locked.length === 0) {
      throw new BadRequestException(
        apiError(
          "CONTAINER_NOT_LOCKED",
          "контейнер не подтверждён — разблокировать нечего",
        ),
      );
    }

    for (const allocation of locked) {
      allocation.isLocked = false;
    }
    await allocationRepo.save(locked);
    container.confirmedAt = null;
    container.confirmedBy = null;
    await containerRepo.save(container);

    // Event 3 (Phase 13): no "proposed_to_client" status exists here — this
    // is the one ops action that puts a container back in front of the
    // client for review (see notification-events.ts for the reasoning).
    this.eventEmitter.emit(NotificationEvent.CONTAINER_REOPENED_FOR_CLIENT, {
      label: container.label,
      customerId: container.customer.id,
    });

    return {
      id: container.id,
      label: container.label,
      customerId: container.customer.id,
      isConfirmed: false,
    };
  }

  /**
   * Phase 16: the finer-grained sibling of unlock() — frees one position
   * without touching the rest of its container, which can stay locked. The
   * client can then edit (move/remove) just this one row; confirm() picks
   * it back up along with any other draft later, same as unlock()'s
   * whole-container version already did.
   */
  async unlockAllocation(
    allocationId: string,
    actor: RequestUser,
  ): Promise<UnlockedAllocationView> {
    if (actor.role !== Role.OPS) {
      throw new ForbiddenException(
        apiError(
          "OPS_ONLY_ACTION",
          "Разблокировка позиции доступна только CEAT",
        ),
      );
    }

    const allocationRepo = this.dataSource.manager.getRepository(
      ContainerLineAllocation,
    );
    const allocation = await allocationRepo.findOne({
      where: { id: allocationId },
      relations: ["container", "container.customer"],
    });
    if (!allocation) {
      throw new NotFoundException(
        apiError(
          "NOT_FOUND",
          `ContainerLineAllocation ${allocationId} not found`,
        ),
      );
    }
    if (!allocation.isLocked) {
      throw new BadRequestException(
        apiError(
          "ALLOCATION_NOT_LOCKED",
          "позиция не заблокирована — разблокировать нечего",
        ),
      );
    }

    allocation.isLocked = false;
    await allocationRepo.save(allocation);

    // Same trigger as unlock()'s Event 3 (Phase 13), just at the finer
    // grain — freeing even one position is still "the client should look at
    // this container again".
    this.eventEmitter.emit(NotificationEvent.CONTAINER_REOPENED_FOR_CLIENT, {
      label: allocation.container.label,
      customerId: allocation.container.customer.id,
    });

    return {
      id: allocation.id,
      containerId: allocation.container.id,
      containerLabel: allocation.container.label,
      customerId: allocation.container.customer.id,
      isLocked: false,
    };
  }

  private requireClient(actor: RequestUser): string {
    if (actor.role !== Role.CLIENT || !actor.customerId) {
      throw new ForbiddenException(
        apiError("CLIENT_ONLY_ACTION", "Действие доступно только клиенту"),
      );
    }
    return actor.customerId;
  }

  private resolveViewCustomerId(
    actor: RequestUser,
    requested?: string,
  ): string {
    if (actor.role === Role.CLIENT) {
      if (!actor.customerId) {
        throw new ForbiddenException(
          apiError(
            "USER_NOT_LINKED_TO_CUSTOMER",
            "Пользователь не привязан к клиенту",
          ),
        );
      }
      if (requested && requested !== actor.customerId) {
        throw new NotFoundException(
          apiError("NOT_FOUND", "Customer not found"),
        );
      }
      return actor.customerId;
    }
    if (!requested) {
      throw new BadRequestException(
        apiError("CUSTOMER_ID_REQUIRED", "customerId обязателен"),
      );
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
      throw new NotFoundException(
        apiError("NOT_FOUND", `ShippingContainer ${containerId} not found`),
      );
    }
    return container;
  }

  /**
   * Every allocation across this customer's containers that is *not*
   * locked — the scope undo/confirm now work over, since Phase 16 moved
   * locking from the whole container down to each position. Loaded with
   * `container`/`piLineItem` because every caller groups or keys by one of
   * those.
   */
  /**
   * The complement of "unlocked", by design: a position that was moved in
   * and then fully removed again has no allocation row left at all, so it
   * can never be found by querying for "isLocked: false" rows — but it's
   * still exactly as undoable as one that does still exist. Checking "is
   * this (container, line) pair currently *locked*" instead handles both
   * cases the same way, since a nonexistent row is trivially not locked.
   */
  private async findLockedAllocationKeys(
    em: EntityManager,
    customerId: string,
  ): Promise<Set<string>> {
    const containers = await em
      .getRepository(ShippingContainer)
      .find({ where: { customer: { id: customerId } } });
    const containerIds = containers.map((c) => c.id);
    if (!containerIds.length) {
      return new Set();
    }
    const locked = await em.getRepository(ContainerLineAllocation).find({
      where: { container: { id: In(containerIds) }, isLocked: true },
      relations: ["container", "piLineItem"],
    });
    return new Set(
      locked.map((a) => allocationKey(a.container.id, a.piLineItem.id)),
    );
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
    // update(), not save(): save() on an existing entity re-reads it first,
    // which is one more network round trip for nothing here.
    await em
      .getRepository(ContainerLineAllocation)
      .update({ id: allocation.id }, { allocatedQty: allocation.allocatedQty });
  }

  /**
   * Undoing a "remove" puts its quantity back. Strictly last-in-first-out
   * that always fits, but a confirm can freeze a later move of the same line
   * (into another container) while this removal is still the newest undoable
   * action — so the line's remainder is checked instead of assumed.
   */
  private async restoreRemoved(
    em: EntityManager,
    action: AllocationAction,
    qty: number,
  ): Promise<void> {
    const line = await em.getRepository(PiLineItem).findOne({
      where: { id: action.piLineItem.id },
      lock: { mode: "pessimistic_write" },
    });
    const allocationRepo = em.getRepository(ContainerLineAllocation);
    const placed = (
      await allocationRepo.find({
        where: { piLineItem: { id: action.piLineItem.id } },
      })
    ).reduce((sum, a) => sum + (toNumberOrNull(a.allocatedQty) ?? 0), 0);
    const remaining =
      (toNumberOrNull(line?.currentWeekDispatchQty) ?? 0) - placed;
    if (qty > remaining) {
      throw new BadRequestException(
        apiError(
          "UNDO_REMOVE_CONFLICT",
          `нельзя отменить удаление: ${qty} шт. этой строки уже размещены в другом контейнере (свободно ${Math.max(0, remaining)})`,
          { qty, remaining: Math.max(0, remaining) },
        ),
      );
    }

    const existing = await allocationRepo.findOne({
      where: {
        container: { id: action.container.id },
        piLineItem: { id: action.piLineItem.id },
      },
    });
    if (existing) {
      await this.setAllocatedQty(
        em,
        existing,
        (toNumberOrNull(existing.allocatedQty) ?? 0) + qty,
      );
      return;
    }
    await allocationRepo.save(
      allocationRepo.create({
        container: { id: action.container.id } as ShippingContainer,
        piLineItem: { id: action.piLineItem.id } as PiLineItem,
        allocatedQty: String(qty),
        isLocked: false,
      }),
    );
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
    // Every view is several independent reads, and each one is a network
    // round trip to Postgres (~100 ms from the VPS to Neon) — so they run
    // side by side on the pool instead of one after another, and the slot
    // top-up (its own transaction) only happens when a slot is actually
    // missing, not on every read.
    const em = this.dataSource.manager;
    const containerRepo = em.getRepository(ShippingContainer);
    const findContainers = () =>
      containerRepo.find({
        where: { customer: { id: customerId } },
        relations: ["confirmedBy"],
      });
    const [lines, existingContainers] = await Promise.all([
      this.loadActiveLines(em, customerId),
      findContainers(),
    ]);
    const totalPossibleContainers = computeTotalPossibleContainers(lines);
    const containers = (
      existingContainers.length < totalPossibleContainers
        ? (await this.ensureContainerSlots(customerId, totalPossibleContainers),
          await findContainers())
        : existingContainers
    ).sort(byLabel);
    const containerIds = containers.map((c) => c.id);

    const allocations = containerIds.length
      ? await em.getRepository(ContainerLineAllocation).find({
          where: { container: { id: In(containerIds) } },
          relations: ["container", "piLineItem", "piLineItem.pi"],
        })
      : [];
    // Only an action whose own position isn't currently locked counts toward
    // "undo can still reach this" (Phase 16: a container can now mix locked
    // and unlocked positions). Keyed off *locked* positions, not unlocked
    // ones — a position moved in and then fully removed again has no
    // allocation row left to find as "unlocked", but it's absent from
    // lockedKeys too, so it still counts correctly (see
    // findLockedAllocationKeys/undoLast for the same reasoning).
    const lockedKeys = new Set(
      allocations
        .filter((a) => a.isLocked)
        .map((a) => allocationKey(a.container.id, a.piLineItem.id)),
    );
    const [actionRows, markings] = await Promise.all([
      containerIds.length
        ? em.getRepository(AllocationAction).find({
            where: { container: { id: In(containerIds) } },
            relations: ["container", "piLineItem"],
          })
        : Promise.resolve([] as AllocationAction[]),
      allocations.length
        ? em.getRepository(MarkingFile).find({
            where: { allocation: { id: In(allocations.map((a) => a.id)) } },
            relations: ["allocation"],
          })
        : Promise.resolve([] as MarkingFile[]),
    ]);
    const undoableActions = actionRows.filter(
      (a) => !lockedKeys.has(allocationKey(a.container.id, a.piLineItem.id)),
    ).length;
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
          piLabel: item.pi.label ?? null,
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
            piLabel: line.pi.label ?? null,
            soNumber: line.soNumber,
            materialNum: line.materialNum,
            materialDesc: line.materialDesc,
            loadability,
            allocatedQty,
            isLocked: allocation.isLocked,
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
      // Phase 16: derived from the container's own positions, not stored —
      // fully confirmed only when it has at least one position and every one
      // of them is locked; partially unlocked when the lock state is mixed.
      const lockedCount = allocationViews.filter((a) => a.isLocked).length;
      const isConfirmed =
        allocationViews.length > 0 && lockedCount === allocationViews.length;
      const isPartiallyUnlocked =
        lockedCount > 0 && lockedCount < allocationViews.length;
      return {
        id: container.id,
        label: container.label,
        isConfirmed,
        isPartiallyUnlocked,
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
      undoableActions,
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
