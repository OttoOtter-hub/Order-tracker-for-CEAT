import { Injectable } from "@nestjs/common";
import { DataSource, In } from "typeorm";
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
 */
@Injectable()
export class AllocationRelinkService {
  constructor(private readonly dataSource: DataSource) {}

  async relink(oldItems: PiLineItem[], newItems: PiLineItem[]): Promise<void> {
    if (oldItems.length === 0) {
      return;
    }

    const newIdByOldId = pairLineItems(oldItems, newItems);

    await this.dataSource.transaction(async (em) => {
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

      for (const allocation of allocations) {
        const newId = newIdByOldId.get(allocation.piLineItem.id);
        if (newId) {
          allocation.piLineItem = { id: newId } as PiLineItem;
          await allocationRepo.save(allocation);
        } else {
          await em
            .getRepository(MarkingFile)
            .delete({ allocation: { id: allocation.id } });
          await allocationRepo.delete({ id: allocation.id });
        }
      }
      for (const action of actions) {
        const newId = newIdByOldId.get(action.piLineItem.id);
        if (newId) {
          action.piLineItem = { id: newId } as PiLineItem;
          await actionRepo.save(action);
        } else {
          await actionRepo.delete({ id: action.id });
        }
      }
    });
  }
}
