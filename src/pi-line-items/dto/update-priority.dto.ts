import { IsInt, Min } from "class-validator";
import { errorContext } from "../../common/errors/api-error";

export class UpdatePriorityDto {
  // Whole units only — priority counts tires, never a fraction of one.
  // @IsInt() (not @IsNumber()) rejects e.g. 0.02 at the HTTP boundary,
  // before it ever reaches the service. Upper bound is per-row (that line
  // item's own balanceToBeDelivered), so it can't be a static decorator
  // here — checked in the service against the actual row once it's loaded,
  // which is also where the integer check is repeated (see
  // PiLineItemsService.updatePriority) — this project's service specs
  // instantiate the service directly, bypassing this DTO/ValidationPipe
  // entirely, so the decorator alone isn't unit-testable.
  @IsInt({
    message: "приоритет указывается в целых штуках",
    context: errorContext("PRIORITY_QTY_NOT_INTEGER"),
  })
  @Min(0)
  priorityQty: number;
}
