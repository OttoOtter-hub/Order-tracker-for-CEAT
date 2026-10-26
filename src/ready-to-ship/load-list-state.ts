import { BadRequestException } from "@nestjs/common";
import { EntityManager, In } from "typeorm";
import { RequestUser } from "../common/auth/request-user.interface";
import { Role } from "../common/enums/role.enum";
import { apiError } from "../common/errors/api-error";
import { toNumberOrNull } from "../common/utils/numeric";
import { AllocationAction } from "./allocation-action.entity";
import { ContainerLineAllocation } from "./container-line-allocation.entity";
import { LoadList, LoadListStatus } from "./load-list.entity";
import type { LoadListSnapshot, LineKey } from "./load-list.types";
import { ShippingContainer } from "./shipping-container.entity";

/** Who may change the layout in each status — nobody in the others. */
export const EDITOR_BY_STATUS: Record<LoadListStatus, Role | null> = {
  [LoadListStatus.DRAFT_CEAT]: Role.OPS,
  [LoadListStatus.SENT_TO_CLIENT]: null,
  [LoadListStatus.CLIENT_EDITING]: Role.CLIENT,
  [LoadListStatus.SUBMITTED_BY_CLIENT]: null,
  [LoadListStatus.CONFIRMED]: null,
};

/** The customer's load list row; created (as draft_ceat) on first need. */
export async function findOrCreateLoadList(
  em: EntityManager,
  customerId: string,
  lock = false,
): Promise<LoadList> {
  const repo = em.getRepository(LoadList);
  const find = () =>
    repo.findOne({
      where: { customerId },
      ...(lock ? { lock: { mode: "pessimistic_write" as const } } : {}),
    });
  const existing = await find();
  if (existing) {
    return existing;
  }
  try {
    await repo.save(
      repo.create({ customerId, status: LoadListStatus.DRAFT_CEAT }),
    );
  } catch (error) {
    // A concurrent first read created it: the unique customer_id says so.
    if ((error as { code?: string })?.code !== "23505") throw error;
  }
  return (await find())!;
}

/**
 * Every edit of the layout starts here, inside its transaction: the load
 * list row is locked (so a status change can't slip in between this check
 * and the write) and the actor must be the one who edits in this status —
 * ops in draft_ceat, the client in client_editing.
 */
export async function assertEditable(
  em: EntityManager,
  customerId: string,
  actor: RequestUser,
): Promise<LoadList> {
  const loadList = await findOrCreateLoadList(em, customerId, true);
  if (EDITOR_BY_STATUS[loadList.status] !== actor.role) {
    throw new BadRequestException(
      apiError(
        "LOAD_LIST_NOT_EDITABLE",
        `load list в статусе ${loadList.status} — изменять его сейчас нельзя`,
        { status: loadList.status },
      ),
    );
  }
  return loadList;
}

/** Locks the row and refuses unless it is in one of `allowed`. */
export async function requireStatus(
  em: EntityManager,
  customerId: string,
  allowed: LoadListStatus[],
): Promise<LoadList> {
  const loadList = await findOrCreateLoadList(em, customerId, true);
  if (!allowed.includes(loadList.status)) {
    throw new BadRequestException(
      apiError(
        "LOAD_LIST_WRONG_STATUS",
        `действие недоступно: load list в статусе ${loadList.status}`,
        { status: loadList.status },
      ),
    );
  }
  return loadList;
}

/**
 * The undo log belongs to whoever is editing now: every status change drops
 * it, so the client can't undo CEAT's moves, nor CEAT the client's.
 */
export async function clearUndoLog(
  em: EntityManager,
  customerId: string,
): Promise<void> {
  await em
    .getRepository(AllocationAction)
    .delete({ customer: { id: customerId } });
}

export function lineKeyOf(line: {
  materialNum: string | null;
  soNumber: string | null;
  pi: { piNumber: string };
}): LineKey {
  return {
    piNumber: line.pi.piNumber,
    materialNum: line.materialNum,
    soNumber: line.soNumber,
  };
}

export function keyString(key: LineKey): string {
  return `${key.piNumber}|${key.materialNum ?? ""}|${key.soNumber ?? ""}`;
}

/** The customer's whole current layout as a snapshot. */
export async function takeSnapshot(
  em: EntityManager,
  customerId: string,
  actor: RequestUser,
): Promise<LoadListSnapshot> {
  const containers = await em
    .getRepository(ShippingContainer)
    .find({ where: { customer: { id: customerId } } });
  const allocations = containers.length
    ? await em.getRepository(ContainerLineAllocation).find({
        where: { container: { id: In(containers.map((c) => c.id)) } },
        relations: ["container", "piLineItem", "piLineItem.pi"],
      })
    : [];
  return {
    takenAt: new Date().toISOString(),
    takenBy: actor.email,
    containers: containers
      .map((container) => ({
        label: container.label,
        name: container.name ?? null,
        isOkToMix: container.isOkToMix ?? false,
        isManual: container.isManual ?? false,
        positions: allocations
          .filter((a) => a.container.id === container.id)
          .map((a) => ({
            ...lineKeyOf(a.piLineItem),
            piLineItemId: a.piLineItem.id,
            piLabel: a.piLineItem.pi.label ?? null,
            materialDesc: a.piLineItem.materialDesc,
            loadability: toNumberOrNull(a.piLineItem.loadability),
            qty: toNumberOrNull(a.allocatedQty) ?? 0,
            locked: a.isLocked,
          })),
      }))
      // Empty containers carry nothing to restore or compare.
      .filter((c) => c.positions.length > 0),
  };
}
