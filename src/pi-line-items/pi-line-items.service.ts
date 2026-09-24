import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { RequestUser } from "../common/auth/request-user.interface";
import { Role } from "../common/enums/role.enum";
import { apiError } from "../common/errors/api-error";
import { toNumberOrNull } from "../common/utils/numeric";
import { AuditLogService } from "../audit-log/audit-log.service";
import { PiLineItem } from "./pi-line-item.entity";

@Injectable()
export class PiLineItemsService {
  constructor(
    @InjectRepository(PiLineItem)
    private readonly repo: Repository<PiLineItem>,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Client-only, planning-mode priority for a single line item — ops can
   * see priorityQty (it's just a column, included on every
   * GET /proforma-invoices/:id response) but must not set it directly, so
   * this checks actor.role explicitly rather than leaving it to RolesGuard:
   * that guard's blanket "ops always allowed" rule (see roles.guard.ts) is
   * right for every other write in this project but wrong here — this is
   * the client's own planning input, not something ops enters on their
   * behalf. Ownership (does this line item's PI belong to the actor's
   * customer) is checked here too, not left to a response-shape interceptor
   * — same reasoning as every other client-facing write in this project
   * (see ProformaInvoicesService.findOwnedByActor).
   */
  async updatePriority(
    id: string,
    priorityQty: number,
    actor: RequestUser,
  ): Promise<PiLineItem> {
    if (actor.role !== Role.CLIENT) {
      throw new ForbiddenException(
        apiError("CLIENT_ONLY_ACTION", "Приоритизация доступна только клиенту"),
      );
    }

    const item = await this.repo.findOne({
      where: { id },
      relations: ["pi", "pi.customer"],
    });
    if (!item || item.pi.customer.id !== actor.customerId) {
      throw new NotFoundException(
        apiError("NOT_FOUND", `PiLineItem ${id} not found`),
      );
    }

    // Repeats the DTO's @IsInt() check — real HTTP callers already get
    // rejected there before reaching this method, but this project's
    // service specs instantiate PiLineItemsService directly and call this
    // with a raw number, bypassing the DTO/ValidationPipe entirely (see
    // UpdatePriorityDto's comment). Tires ship in whole units; 0.02 of one
    // isn't a real priority.
    if (!Number.isInteger(priorityQty)) {
      throw new BadRequestException(
        apiError(
          "PRIORITY_QTY_NOT_INTEGER",
          "приоритет указывается в целых штуках",
        ),
      );
    }

    const maxQty = toNumberOrNull(item.balanceToBeDelivered) ?? 0;
    if (priorityQty > maxQty) {
      throw new BadRequestException(
        apiError(
          "PRIORITY_QTY_OUT_OF_RANGE",
          `priorityQty must be between 0 and ${maxQty} (this row's balance to be delivered)`,
          { max: maxQty },
        ),
      );
    }

    const previousQty = toNumberOrNull(item.priorityQty) ?? 0;
    item.priorityQty = String(priorityQty);
    const saved = await this.repo.save(item);
    if (previousQty !== priorityQty) {
      await this.audit.record({
        actor,
        action: "pi.priority_changed",
        entityType: "pi",
        entityId: item.pi.id,
        metadata: {
          piNumber: item.pi.piNumber,
          lineItemId: item.id,
          materialNum: item.materialNum,
          soNumber: item.soNumber,
          from: previousQty,
          to: priorityQty,
        },
      });
    }
    return saved;
  }
}
