import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { FindOptionsWhere, ILike, In, Like, Repository } from "typeorm";
import { ActualContainerLineItem } from "../actual-containers/actual-container-line-item.entity";
import { RequestUser } from "../common/auth/request-user.interface";
import { Role } from "../common/enums/role.enum";
import { apiError } from "../common/errors/api-error";
import { PiLineItem } from "../pi-line-items/pi-line-item.entity";
import { PiStatus } from "../proforma-invoices/enums/pi-status.enum";
import { ProformaInvoice } from "../proforma-invoices/proforma-invoice.entity";
import { ContainerLineAllocation } from "../ready-to-ship/container-line-allocation.entity";

/** At most this many hits per section; `truncated` says there were more. */
export const SEARCH_LIMIT_PER_SOURCE = 20;

/**
 * Rows read per source before they are folded into hits (one hit per
 * target and material — a material on three SO lines of one card is one
 * hit). Generous enough that SEARCH_LIMIT_PER_SOURCE distinct hits survive
 * the folding, small enough that a one-letter query doesn't pull the whole
 * backorder.
 */
const RAW_ROWS_PER_SOURCE = 200;

export interface SearchSection<T> {
  items: T[];
  truncated: boolean;
}

/** A material on an active PI card — a backorder row or a fully shipped one. */
export interface PiSearchHit {
  piId: string;
  piNumber: string;
  piLabel: string | null;
  status: PiStatus;
  // Only in Dispatch, not (any more) in the card's backorder rows.
  isShippedOnly: boolean;
  customerId: string;
  materialNum: string | null;
  materialDesc: string | null;
}

/** A material placed in a container of "Ready to ship". */
export interface ReadyToShipSearchHit {
  containerId: string;
  containerLabel: string;
  containerName: string | null;
  isOkToMix: boolean;
  // Every position of this material in the container is locked.
  isConfirmed: boolean;
  customerId: string;
  materialNum: string | null;
  materialDesc: string | null;
}

/** A material in a dispatched ("Shipped") container. */
export interface ShippedSearchHit {
  actualContainerId: string;
  containerNumber: string;
  customerId: string;
  materialNum: string | null;
  materialDesc: string | null;
}

export interface SearchResult {
  query: string;
  pi: SearchSection<PiSearchHit>;
  readyToShip: SearchSection<ReadyToShipSearchHit>;
  shipped: SearchSection<ShippedSearchHit>;
}

function emptySection<T>(): SearchSection<T> {
  return { items: [], truncated: false };
}

/** "10%_a" -> "%10\%\_a%": the text is matched as typed, anywhere. */
function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * Material number: a substring exactly as typed. Description (which holds
 * the tyre size — there is no separate column): a substring in any case.
 */
function materialMatch(pattern: string) {
  return [
    { materialNum: Like(pattern) },
    { materialDesc: ILike(pattern) },
  ] as const;
}

function hitKey(targetId: string, materialNum: string | null): string {
  return `${targetId}|${materialNum ?? ""}`;
}

function byMaterialThen<T extends { materialNum: string | null }>(
  tieBreak: (hit: T) => string,
) {
  return (a: T, b: T) =>
    (a.materialNum ?? "").localeCompare(b.materialNum ?? "") ||
    tieBreak(a).localeCompare(tieBreak(b));
}

function toSection<T>(
  hits: T[],
  rawRowCounts: number[],
  compare: (a: T, b: T) => number,
): SearchSection<T> {
  return {
    items: [...hits].sort(compare).slice(0, SEARCH_LIMIT_PER_SOURCE),
    truncated:
      hits.length > SEARCH_LIMIT_PER_SOURCE ||
      rawRowCounts.some((count) => count >= RAW_ROWS_PER_SOURCE),
  };
}

/**
 * The header search: one material across the three places it can be —
 * active PI cards, "Ready to ship" containers and "Shipped" containers.
 * Each section is capped at SEARCH_LIMIT_PER_SOURCE; grouping by material
 * and deciding where a click leads is the frontend's job.
 */
@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(ProformaInvoice)
    private readonly piRepo: Repository<ProformaInvoice>,
    @InjectRepository(PiLineItem)
    private readonly lineItemRepo: Repository<PiLineItem>,
    @InjectRepository(ContainerLineAllocation)
    private readonly allocationRepo: Repository<ContainerLineAllocation>,
    @InjectRepository(ActualContainerLineItem)
    private readonly dispatchRepo: Repository<ActualContainerLineItem>,
  ) {}

  async search(
    actor: RequestUser,
    rawQuery: string | undefined,
    requestedCustomerId?: string,
  ): Promise<SearchResult> {
    const customerId = this.resolveCustomerId(actor, requestedCustomerId);
    const query = (rawQuery ?? "").trim();
    if (!query) {
      return {
        query,
        pi: emptySection(),
        readyToShip: emptySection(),
        shipped: emptySection(),
      };
    }
    const pattern = containsPattern(query);
    const [pi, readyToShip, shipped] = await Promise.all([
      this.searchPi(pattern, customerId),
      this.searchReadyToShip(pattern, customerId),
      this.searchShipped(pattern, customerId),
    ]);
    return { query, pi, readyToShip, shipped };
  }

  /**
   * Active (not archived) cards only. A card shows a material either as a
   * backorder row or — Dispatch knows it, the backorder doesn't — as a
   * fully shipped row built on read (applyShippedOnlyLines); both count.
   */
  private async searchPi(
    pattern: string,
    customerId: string | undefined,
  ): Promise<SearchSection<PiSearchHit>> {
    const cards = await this.piRepo.find({
      where: {
        isArchivedShipped: false,
        ...(customerId ? { customer: { id: customerId } } : {}),
      },
      relations: ["customer"],
    });
    if (cards.length === 0) {
      return emptySection();
    }
    const cardById = new Map(cards.map((card) => [card.id, card]));
    const cardByNumber = new Map(cards.map((card) => [card.piNumber, card]));
    const inCards = { pi: { id: In([...cardById.keys()]) } };

    const [backorderRows, dispatchRows] = await Promise.all([
      this.lineItemRepo.find({
        where: materialMatch(pattern).map((match) => ({
          ...inCards,
          ...match,
        })),
        relations: ["pi"],
        take: RAW_ROWS_PER_SOURCE,
      }),
      this.dispatchRepo.find({
        where: materialMatch(pattern).map((match) => ({
          piNumber: In([...cardByNumber.keys()]),
          ...match,
        })),
        take: RAW_ROWS_PER_SOURCE,
      }),
    ]);

    const hits = new Map<string, PiSearchHit>();
    const hit = (
      card: ProformaInvoice,
      row: { materialNum: string | null; materialDesc: string | null },
      isShippedOnly: boolean,
    ): PiSearchHit => ({
      piId: card.id,
      piNumber: card.piNumber,
      piLabel: card.label,
      status: card.status,
      isShippedOnly,
      customerId: card.customer.id,
      materialNum: row.materialNum,
      materialDesc: row.materialDesc,
    });

    for (const row of backorderRows) {
      const card = cardById.get(row.pi.id);
      const key = card && hitKey(card.id, row.materialNum);
      if (card && key && !hits.has(key)) {
        hits.set(key, hit(card, row, false));
      }
    }

    // A Dispatch material is "fully shipped" only if the card has no
    // backorder row for it at all — the matched rows above may miss one
    // whose description reads differently, so ask the card itself.
    const dispatchOnly = dispatchRows.filter((row) => {
      const card = row.piNumber ? cardByNumber.get(row.piNumber) : undefined;
      return card && !hits.has(hitKey(card.id, row.materialNum));
    });
    const materials = [
      ...new Set(
        dispatchOnly
          .map((row) => row.materialNum)
          .filter((m): m is string => !!m),
      ),
    ];
    const inBackorder = new Set(
      (materials.length
        ? await this.lineItemRepo.find({
            where: { ...inCards, materialNum: In(materials) },
            relations: ["pi"],
          })
        : []
      ).map((row) => hitKey(row.pi.id, row.materialNum)),
    );
    for (const row of dispatchOnly) {
      const card = cardByNumber.get(row.piNumber!)!;
      const key = hitKey(card.id, row.materialNum);
      if (!hits.has(key)) {
        hits.set(key, hit(card, row, !inBackorder.has(key)));
      }
    }

    return toSection(
      [...hits.values()],
      [backorderRows.length, dispatchRows.length],
      byMaterialThen((h) => h.piNumber),
    );
  }

  private async searchReadyToShip(
    pattern: string,
    customerId: string | undefined,
  ): Promise<SearchSection<ReadyToShipSearchHit>> {
    const inScope: FindOptionsWhere<ContainerLineAllocation> = customerId
      ? { container: { customer: { id: customerId } } }
      : {};
    const allocations = await this.allocationRepo.find({
      where: materialMatch(pattern).map((match) => ({
        ...inScope,
        piLineItem: match,
      })),
      relations: ["container", "container.customer", "piLineItem"],
      take: RAW_ROWS_PER_SOURCE,
    });

    const hits = new Map<string, ReadyToShipSearchHit>();
    for (const allocation of allocations) {
      const { container, piLineItem: line } = allocation;
      const key = hitKey(container.id, line.materialNum);
      const existing = hits.get(key);
      if (existing) {
        existing.isConfirmed &&= allocation.isLocked;
        continue;
      }
      hits.set(key, {
        containerId: container.id,
        containerLabel: container.label,
        containerName: container.name ?? null,
        isOkToMix: container.isOkToMix ?? false,
        isConfirmed: allocation.isLocked,
        customerId: container.customer.id,
        materialNum: line.materialNum,
        materialDesc: line.materialDesc,
      });
    }

    return toSection(
      [...hits.values()],
      [allocations.length],
      byMaterialThen((h) => h.containerLabel),
    );
  }

  private async searchShipped(
    pattern: string,
    customerId: string | undefined,
  ): Promise<SearchSection<ShippedSearchHit>> {
    const inScope: FindOptionsWhere<ActualContainerLineItem> = customerId
      ? { actualContainer: { customer: { id: customerId } } }
      : {};
    const rows = await this.dispatchRepo.find({
      where: materialMatch(pattern).map((match) => ({ ...inScope, ...match })),
      relations: ["actualContainer", "actualContainer.customer"],
      take: RAW_ROWS_PER_SOURCE,
    });

    const hits = new Map<string, ShippedSearchHit>();
    for (const row of rows) {
      const container = row.actualContainer;
      const key = hitKey(container.id, row.materialNum);
      if (!hits.has(key)) {
        hits.set(key, {
          actualContainerId: container.id,
          containerNumber: container.containerNumber,
          customerId: container.customer.id,
          materialNum: row.materialNum,
          materialDesc: row.materialDesc,
        });
      }
    }

    return toSection(
      [...hits.values()],
      [rows.length],
      byMaterialThen((h) => h.containerNumber),
    );
  }

  /**
   * A client searches their own customer (asking for another one is a 404,
   * as everywhere). Ops names a customer with the same customerId parameter
   * as GET /ready-to-ship — or none, and searches them all; every hit
   * carries its customerId so the frontend can open the right one.
   */
  private resolveCustomerId(
    actor: RequestUser,
    requested?: string,
  ): string | undefined {
    if (actor.role !== Role.CLIENT) {
      return requested;
    }
    if (!actor.customerId) {
      throw new ForbiddenException(
        apiError(
          "USER_NOT_LINKED_TO_CUSTOMER",
          "Пользователь не привязан к клиенту",
        ),
      );
    }
    if (requested && requested !== actor.customerId) {
      throw new NotFoundException(apiError("NOT_FOUND", "Customer not found"));
    }
    return actor.customerId;
  }
}
