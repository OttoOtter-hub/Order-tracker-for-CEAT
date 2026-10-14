import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager, In } from "typeorm";
import { bulkUpdateById } from "../common/utils/bulk-update";
import { PiLineItem } from "../pi-line-items/pi-line-item.entity";
import { AllocationAction } from "./allocation-action.entity";
import { ContainerLineAllocation } from "./container-line-allocation.entity";
import { MarkingFile } from "./marking-file.entity";
import { pairLineItems } from "./utils/pair-line-items";

/**
 * A backorder re-upload deletes a card's line items and recreates them
 * (BackorderUploadsService.upload), but allocations and their undo log point
 * at line items by id. This carries them over to the new rows, matched by
 * (materialNum, soNumber) — the same key the client's priority uses — before
 * the old rows are deleted; a key that repeats within a card is disambiguated
 * by (dispatch qty, balance) first (see pairLineItems). Allocations of a line
 * that is gone from the new snapshot are removed together with their marking
 * files and actions.
 * Quantities are left as they are even if the new dispatch qty is smaller;
 * the ready-to-ship view then just shows no remainder for that line.
 *
 * One call covers a whole upload: rows are paired card by card (by the
 * line item's pi), and every move is one bulk statement rather than a
 * save() per allocation — each of those was a SELECT plus an UPDATE, and
 * at ~110 ms per round trip to Neon a few hundred allocations alone took
 * the upload past the proxy timeout.
 */
@Injectable()
export class AllocationRelinkService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * `manager` joins the caller's transaction (the backorder upload runs in
   * one, and the new line items it points at aren't committed yet, so a
   * separate transaction couldn't even see them); without it the relink is
   * its own transaction.
   */
  async relink(
    oldItems: PiLineItem[],
    newItems: PiLineItem[],
    manager?: EntityManager,
  ): Promise<void> {
    if (oldItems.length === 0) {
      return;
    }

    const newIdByOldId = pairByCard(oldItems, newItems);

    const run = (work: (em: EntityManager) => Promise<void>) =>
      manager ? work(manager) : this.dataSource.transaction(work);

    await run(async (em) => {
      const oldIds = oldItems.map((item) => item.id);
      const allocationRepo = em.getRepository(ContainerLineAllocation);
      const actionRepo = em.getRepository(AllocationAction);

      const allocations = await allocationRepo.find({
        where: { piLineItem: { id: In(oldIds) } },
        relations: ["piLineItem"],
      });
      const actions = await actionRepo.find({
        where: { piLineItem: { id: In(oldIds) } },
        relations: ["piLineItem"],
      });

      const relinked = allocations.filter((a) =>
        newIdByOldId.get(a.piLineItem.id),
      );
      const goneAllocationIds = allocations
        .filter((a) => !newIdByOldId.get(a.piLineItem.id))
        .map((a) => a.id);
      await bulkUpdateById(
        em,
        ContainerLineAllocation,
        relinked.map((a) => ({
          id: a.id,
          values: { piLineItem: newIdByOldId.get(a.piLineItem.id)! },
        })),
      );
      if (goneAllocationIds.length > 0) {
        await em
          .getRepository(MarkingFile)
          .delete({ allocation: { id: In(goneAllocationIds) } });
        await allocationRepo.delete({ id: In(goneAllocationIds) });
      }

      await bulkUpdateById(
        em,
        AllocationAction,
        actions
          .filter((a) => newIdByOldId.get(a.piLineItem.id))
          .map((a) => ({
            id: a.id,
            values: { piLineItem: newIdByOldId.get(a.piLineItem.id)! },
          })),
      );
      const goneActionIds = actions
        .filter((a) => !newIdByOldId.get(a.piLineItem.id))
        .map((a) => a.id);
      if (goneActionIds.length > 0) {
        await actionRepo.delete({ id: In(goneActionIds) });
      }
    });
  }
}

/** pairLineItems card by card: keys only mean "the same line" within one card. */
function pairByCard(
  oldItems: PiLineItem[],
  newItems: PiLineItem[],
): Map<string, string | null> {
  const cardOf = (item: PiLineItem) => item.pi?.id ?? "";
  const newByCard = new Map<string, PiLineItem[]>();
  for (const item of newItems) {
    newByCard.set(cardOf(item), [...(newByCard.get(cardOf(item)) ?? []), item]);
  }
  const oldByCard = new Map<string, PiLineItem[]>();
  for (const item of oldItems) {
    oldByCard.set(cardOf(item), [...(oldByCard.get(cardOf(item)) ?? []), item]);
  }
  const paired = new Map<string, string | null>();
  for (const [card, olds] of oldByCard) {
    for (const [oldId, newId] of pairLineItems(
      olds,
      newByCard.get(card) ?? [],
    )) {
      paired.set(oldId, newId);
    }
  }
  return paired;
}
