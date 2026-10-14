import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  In,
  Repository,
} from "typeorm";
import { ActualContainersImportService } from "../actual-containers/actual-containers-import.service";
import { apiError } from "../common/errors/api-error";
import { AuditLogService } from "../audit-log/audit-log.service";
import { decodeMultipartFilename } from "../common/utils/decode-multipart-filename";
import { CustomersService } from "../customers/customers.service";
import { FilesService } from "../files/files.service";
import { RequestUser } from "../common/auth/request-user.interface";
import { Role } from "../common/enums/role.enum";
import { User } from "../users/user.entity";
import { PiLineItem } from "../pi-line-items/pi-line-item.entity";
import { ProformaInvoice } from "../proforma-invoices/proforma-invoice.entity";
import { PiCreatedFrom } from "../proforma-invoices/enums/pi-created-from.enum";
import { lineItemKey } from "../pi-line-items/utils/line-item-key";
import { AllocationRelinkService } from "../ready-to-ship/allocation-relink.service";
import { BackorderUpload } from "./backorder-upload.entity";
import { BackorderUploadSnapshot } from "./backorder-upload-snapshot.entity";
import { BackorderUploadResultDto } from "./dto/backorder-upload-result.dto";
import {
  ParsedBackorderRow,
  parseBackorderFile,
} from "./utils/parse-backorder-file";
import { computePiAggregates } from "./utils/compute-pi-aggregates";
import { stampDateOnFilename } from "./utils/stamp-date-on-filename";
import { buildBackorderExportWorkbook } from "./utils/build-backorder-export-workbook";
import { buildSnapshotWorkbook, SnapshotSheet } from "./utils/snapshot-sheets";
import { formatDateForFilename } from "../common/utils/format-date";
import { toNumberOrNull } from "../common/utils/numeric";
import { bulkUpdateById } from "../common/utils/bulk-update";
import { AllocationAction } from "../ready-to-ship/allocation-action.entity";
import { ContainerLineAllocation } from "../ready-to-ship/container-line-allocation.entity";

const SNAPSHOT_INSERT_CHUNK = 500;
const LINE_ITEM_INSERT_CHUNK = 500;

/**
 * Key of the transaction-level advisory lock that lets one backorder upload
 * run at a time (any constant works; it only has to be the same for all).
 */
export const BACKORDER_UPLOAD_LOCK_KEY = 4_202_610;

function numToStr(value: number | null): string | null {
  return value === null ? null : String(value);
}

/**
 * Why a backorder upload archived a card: it was not in the file at all, or
 * it was, but with nothing left to deliver (Σ balance = 0).
 */
export type ArchiveReason = "absent_from_backorder" | "zero_remaining";
@Injectable()
export class BackorderUploadsService {
  constructor(
    @InjectRepository(BackorderUpload)
    private readonly repo: Repository<BackorderUpload>,
    @InjectRepository(ProformaInvoice)
    private readonly piRepo: Repository<ProformaInvoice>,
    private readonly customersService: CustomersService,
    private readonly filesService: FilesService,
    private readonly allocationRelink: AllocationRelinkService,
    private readonly dataSource: DataSource,
    private readonly actualContainersImport: ActualContainersImportService,
    private readonly audit: AuditLogService,
  ) {}

  findAll(): Promise<BackorderUpload[]> {
    return this.repo.find({
      relations: ["uploadedBy"],
      order: { uploadedAt: "DESC" },
    });
  }

  /**
   * One weekly workbook, one transaction — either everything below lands or
   * nothing does:
   *
   * 1. The upload row, then a raw snapshot of every row of every sheet
   *    (BackorderUploadSnapshot — the never-overwritten archive).
   * 2. "Radial BO"/"Bias BO" (see parseBackorderFile), grouped by PI number
   *    (the "Quotation" column), then per PI: creates the card if it doesn't
   *    exist yet (createdFrom = BACKORDER_ROW), un-archives it if it was
   *    previously archived (it's back in the open backorder, so it isn't
   *    "gone" anymore), replaces its line items wholesale with this upload's
   *    rows (a re-upload is a fresh snapshot, not an append — otherwise every
   *    re-upload would double every line), and recomputes its aggregates
   *    (computePiAggregates). Once every card in the upload has been
   *    upserted, any card that's *not* in this snapshot and isn't already
   *    archived gets archived — the file is the source of truth for "what's
   *    still open," so silently dropping out of it means it shipped.
   * 3. The shipped-container sheets (ActualContainersImportService): ETD-ETA
   *    upsert, ETA-15 top-up, Radial/Bias Dispatch line replacement, and the
   *    shipped_qty recompute of every card.
   *
   * Replacing line items wholesale would silently wipe out a client's
   * priorityQty every week if nothing carried it forward — so before the
   * delete, this snapshots each old row's priorityQty keyed by
   * (materialNum, soNumber), and after the new rows are built, looks each
   * one up by that same key and carries the value over, clamped to the
   * *new* balanceToBeDelivered (a shrunk balance means the old priority
   * may no longer be a valid quantity to prioritize — clamp down, never
   * leave it exceeding the row's own balance). A key with no match in the
   * old snapshot (new line, or the old one had priority 0) starts at 0.
   *
   * "Ready to ship" allocations reference line items by id, so the old rows
   * can't just be deleted first: the new rows are saved, allocations are
   * re-pointed at them by the same key (AllocationRelinkService), and only
   * then are the old rows deleted — by id, not by card, since the new rows
   * for the card already exist by that point.
   *
   * The raw copy of the file (StoredFile) is written before the transaction
   * and stays even if the import then fails — it is the audit trail of what
   * was sent, not part of the imported state.
   *
   * One upload at a time: the transaction first takes an advisory lock, so a
   * second upload (a retry after a proxy timeout, say) waits for the first
   * to commit and then works on its result. Without it, two overlapping
   * transactions each read the other's line items as not there yet and
   * both sets survived (2026-10-14, card 100040091).
   *
   * Every step works on all cards at once — one query for all cards, one
   * for all old rows, one bulk insert, one relink, one delete, one update —
   * not a few queries per card: each query is a ~110 ms round trip from the
   * VPS to Neon.
   *
   * A card this upload archives keeps whatever positions it has in "Ready
   * to ship" containers (the client removes them; confirmed ones after ops
   * unlocks); only the undo log entries that no longer matter are dropped —
   * see dropStaleUndoEntries. pi.archived says how many positions are left.
   */
  async upload(
    file: Express.Multer.File,
    actor: RequestUser,
  ): Promise<BackorderUploadResultDto> {
    const uploadedAt = new Date();

    // CEAT's own export keeps the same filename every week ("MTK ROSBERG
    // INR.xlsx"), so the raw copy is stored with the upload date stamped
    // into its name (StoredFile.original_name — the file on disk stays
    // UUID-named regardless, see FilesService) purely so a later look at
    // stored_files/the uploads dir can tell which upload produced which
    // copy. Nothing currently reads this back (no download-original-file
    // endpoint was asked for) — it's a write-only audit trail for now.
    await this.filesService.save(
      {
        ...file,
        originalname: stampDateOnFilename(file.originalname, uploadedAt),
      },
      actor.id,
    );

    const { rows, skippedRowCount, actualContainers, snapshotSheets } =
      await parseBackorderFile(file.buffer);

    const rowsByPiNumber = new Map<string, ParsedBackorderRow[]>();
    for (const row of rows) {
      const group = rowsByPiNumber.get(row.piNumber);
      if (group) {
        group.push(row);
      } else {
        rowsByPiNumber.set(row.piNumber, [row]);
      }
    }

    return this.dataSource.transaction(async (em) => {
      await em.query("SELECT pg_advisory_xact_lock($1)", [
        BACKORDER_UPLOAD_LOCK_KEY,
      ]);
      const uploadRepo = em.getRepository(BackorderUpload);
      const piRepo = em.getRepository(ProformaInvoice);
      const lineItemsRepo = em.getRepository(PiLineItem);

      const upload = await uploadRepo.save(
        uploadRepo.create({
          uploadedAt,
          uploadedBy: { id: actor.id } as User,
          fileName: file.originalname,
          rowsProcessed: rows.length,
          newCardsCreated: 0,
          cardsArchived: 0,
          rowsSkipped: skippedRowCount,
        }),
      );

      const snapshotRows = await this.saveSnapshot(em, upload, snapshotSheets);

      // Every card of the file: the existing ones in one query, the new ones
      // in one insert.
      const piNumbers = [...rowsByPiNumber.keys()];
      const cardByNumber = new Map(
        (piNumbers.length
          ? await piRepo.find({ where: { piNumber: In(piNumbers) } })
          : []
        ).map((card) => [card.piNumber, card]),
      );
      const missing = piNumbers.filter((n) => !cardByNumber.has(n));
      if (missing.length > 0) {
        const customer = await this.customersService.findFirst();
        const created = await piRepo.save(
          missing.map((piNumber) =>
            piRepo.create({
              piNumber,
              customer,
              createdFrom: PiCreatedFrom.BACKORDER_ROW,
              isArchivedShipped: false,
            }),
          ),
        );
        for (const card of created) {
          cardByNumber.set(card.piNumber, card);
        }
      }
      const newCardsCreated = missing.length;
      const cards = piNumbers.map((n) => cardByNumber.get(n)!);

      const oldLineItems = cards.length
        ? await lineItemsRepo.find({
            where: { pi: { id: In(cards.map((card) => card.id)) } },
            relations: ["pi"],
          })
        : [];
      const oldByCard = new Map<string, PiLineItem[]>();
      for (const old of oldLineItems) {
        oldByCard.set(old.pi.id, [...(oldByCard.get(old.pi.id) ?? []), old]);
      }

      const newLineItems: PiLineItem[] = [];
      for (const pi of cards) {
        const oldPriorityByKey = new Map<string, number>();
        for (const old of oldByCard.get(pi.id) ?? []) {
          oldPriorityByKey.set(
            lineItemKey(old.materialNum, old.soNumber),
            toNumberOrNull(old.priorityQty) ?? 0,
          );
        }
        for (const row of rowsByPiNumber.get(pi.piNumber)!) {
          const newBalance = row.balanceToBeDelivered ?? 0;
          const carriedPriority =
            oldPriorityByKey.get(lineItemKey(row.materialNum, row.soNumber)) ??
            0;
          newLineItems.push(
            lineItemsRepo.create({
              pi,
              soNumber: row.soNumber,
              materialNum: row.materialNum,
              materialDesc: row.materialDesc,
              balanceToBeDelivered: numToStr(row.balanceToBeDelivered),
              quantity: numToStr(row.quantity),
              mt: numToStr(row.mt),
              loadFactor: numToStr(row.loadFactor),
              loadability: numToStr(row.loadability),
              currentWeekDispatchLoadFactor: numToStr(
                row.currentWeekDispatchLoadFactor,
              ),
              currentWeekDispatchQty: numToStr(row.currentWeekDispatchQty),
              priorityQty: String(Math.min(carriedPriority, newBalance)),
            }),
          );
        }
      }
      const savedLineItems = newLineItems.length
        ? await lineItemsRepo.save(newLineItems, {
            chunk: LINE_ITEM_INSERT_CHUNK,
          })
        : [];
      // While the old rows still exist: allocations move over to the new ones.
      await this.allocationRelink.relink(oldLineItems, savedLineItems, em);
      if (oldLineItems.length > 0) {
        await lineItemsRepo.delete({
          id: In(oldLineItems.map((old) => old.id)),
        });
      }

      // Cards this upload archives, with why — journaled once each below.
      const archivedNow: Array<{ pi: ProformaInvoice; reason: ArchiveReason }> =
        [];
      for (const pi of cards) {
        const wasArchived = pi.isArchivedShipped;
        const agg = computePiAggregates(rowsByPiNumber.get(pi.piNumber)!);
        pi.totalQty = String(agg.totalQty);
        pi.totalContainers = String(agg.totalContainers);
        pi.qtyPending = String(agg.qtyPending);
        pi.containersPending = String(agg.containersPending);
        pi.currentWeekPlanContainers = String(agg.currentWeekPlanContainers);
        pi.currentWeekPlanQty = String(agg.currentWeekPlanQty);
        // In the file but nothing left to deliver: fully shipped -> archive.
        // Still something left: active (a card archived earlier comes back).
        pi.isArchivedShipped = agg.qtyPending === 0;
        if (pi.isArchivedShipped && !wasArchived) {
          archivedNow.push({ pi, reason: "zero_remaining" });
        }
      }
      await bulkUpdateById(
        em,
        ProformaInvoice,
        cards.map((pi) => ({
          id: pi.id,
          values: {
            totalQty: pi.totalQty,
            totalContainers: pi.totalContainers,
            qtyPending: pi.qtyPending,
            containersPending: pi.containersPending,
            currentWeekPlanContainers: pi.currentWeekPlanContainers,
            currentWeekPlanQty: pi.currentWeekPlanQty,
            isArchivedShipped: pi.isArchivedShipped,
          },
        })),
      );

      // Cards missing from this upload's snapshot (and not already
      // archived) are presumed fully shipped. Line items are left alone —
      // they stay as the last known state, per the pilot's own call not to
      // touch them on archival.
      //
      // A card that has never had line items (created from a PI upload, not
      // yet seen in any backorder) is not "gone from the backorder" — it
      // isn't archived.
      const piNumbersInUpload = new Set(piNumbers);
      const notYetArchived = await piRepo.find({
        where: { isArchivedShipped: false },
      });
      const absent = notYetArchived.filter(
        (candidate) => !piNumbersInUpload.has(candidate.piNumber),
      );
      const withLines = absent.length
        ? new Set(
            (
              await lineItemsRepo.find({
                where: {
                  pi: { id: In(absent.map((candidate) => candidate.id)) },
                },
                relations: ["pi"],
              })
            ).map((item) => item.pi.id),
          )
        : new Set<string>();
      const toArchive = absent.filter((candidate) =>
        withLines.has(candidate.id),
      );
      for (const candidate of toArchive) {
        candidate.isArchivedShipped = true;
        archivedNow.push({ pi: candidate, reason: "absent_from_backorder" });
      }
      if (toArchive.length > 0) {
        await piRepo.update(
          { id: In(toArchive.map((candidate) => candidate.id)) },
          { isArchivedShipped: true },
        );
      }

      const positionsByCard = await this.dropStaleUndoEntries(
        em,
        archivedNow.map(({ pi }) => pi.id),
      );

      const importResult = await this.actualContainersImport.import(
        em,
        actualContainers,
        upload,
      );

      upload.newCardsCreated = newCardsCreated;
      upload.cardsArchived = archivedNow.length;
      const saved = await uploadRepo.save(upload);

      await this.audit.record(
        {
          actor,
          action: "backorder.uploaded",
          entityType: "backorder_upload",
          entityId: saved.id,
          metadata: {
            fileName: decodeMultipartFilename(file.originalname),
            rowsProcessed: saved.rowsProcessed,
            newCardsCreated: saved.newCardsCreated,
            cardsUpdated: rowsByPiNumber.size - newCardsCreated,
            cardsArchived: saved.cardsArchived,
            rowsSkipped: saved.rowsSkipped,
            containersCreated: importResult.containersCreated,
          },
        },
        em,
      );
      // One entry per card this upload archived, with the reason — and, when
      // it still has positions in "Ready to ship" containers, how many and
      // how many of them are confirmed (locked).
      for (const { pi, reason } of archivedNow) {
        const positions = positionsByCard.get(pi.id);
        await this.audit.record(
          {
            actor,
            action: "pi.archived",
            entityType: "pi",
            entityId: pi.id,
            metadata: {
              piNumber: pi.piNumber,
              reason,
              ...(positions
                ? {
                    allocationsInContainers: positions.total,
                    allocationsLocked: positions.locked,
                  }
                : {}),
            },
          },
          em,
        );
      }

      return {
        id: saved.id,
        uploadedAt: saved.uploadedAt,
        fileName: saved.fileName,
        rowsProcessed: saved.rowsProcessed,
        newCardsCreated: saved.newCardsCreated,
        cardsUpdated: rowsByPiNumber.size - newCardsCreated,
        cardsArchived: saved.cardsArchived,
        cardsSkippedInvalidRows: saved.rowsSkipped,
        snapshotRows,
        actualContainers: importResult,
      };
    });
  }

  /**
   * For cards this upload archives: drops the undo log entries
   * (allocation_actions) on their lines that can no longer do anything
   * useful — those of a (container, line) pair that nets out to zero, and
   * those of a position no longer in any container. Entries of positions
   * still in a container stay: "undo all" needs them to roll those back.
   *
   * Returns, per archived card that still has positions in containers, how
   * many there are and how many are locked. The positions themselves are
   * never touched here.
   */
  private async dropStaleUndoEntries(
    em: EntityManager,
    archivedCardIds: string[],
  ): Promise<Map<string, { total: number; locked: number }>> {
    const positionsByCard = new Map<
      string,
      { total: number; locked: number }
    >();
    if (archivedCardIds.length === 0) {
      return positionsByCard;
    }
    const lines = await em.getRepository(PiLineItem).find({
      where: { pi: { id: In(archivedCardIds) } },
      relations: ["pi"],
    });
    if (lines.length === 0) {
      return positionsByCard;
    }
    const cardOfLine = new Map(lines.map((line) => [line.id, line.pi.id]));
    const lineIds = [...cardOfLine.keys()];
    // One after the other: both run on the transaction's single connection.
    const [allocations, actions] = [
      await em.getRepository(ContainerLineAllocation).find({
        where: { piLineItem: { id: In(lineIds) } },
        relations: ["container", "piLineItem"],
      }),
      await em.getRepository(AllocationAction).find({
        where: { piLineItem: { id: In(lineIds) } },
        relations: ["container", "piLineItem"],
      }),
    ];

    const pair = (containerId: string, lineId: string) =>
      `${containerId}:${lineId}`;
    const placed = new Set<string>();
    for (const allocation of allocations) {
      placed.add(pair(allocation.container.id, allocation.piLineItem.id));
      const card = cardOfLine.get(allocation.piLineItem.id)!;
      const counts = positionsByCard.get(card) ?? { total: 0, locked: 0 };
      counts.total++;
      if (allocation.isLocked) counts.locked++;
      positionsByCard.set(card, counts);
    }
    const netByPair = new Map<string, number>();
    for (const action of actions) {
      const key = pair(action.container.id, action.piLineItem.id);
      netByPair.set(
        key,
        (netByPair.get(key) ?? 0) + (toNumberOrNull(action.deltaQty) ?? 0),
      );
    }
    const stale = actions.filter((action) => {
      const key = pair(action.container.id, action.piLineItem.id);
      return !placed.has(key) || netByPair.get(key) === 0;
    });
    if (stale.length > 0) {
      await em
        .getRepository(AllocationAction)
        .delete({ id: In(stale.map((action) => action.id)) });
    }
    return positionsByCard;
  }

  /** Writes every parsed row of every sheet; returns how many rows were archived. */
  private async saveSnapshot(
    em: EntityManager,
    upload: BackorderUpload,
    sheets: SnapshotSheet[],
  ): Promise<number> {
    const repo = em.getRepository(BackorderUploadSnapshot);
    const entities: BackorderUploadSnapshot[] = [];
    for (const sheet of sheets) {
      for (const row of sheet.rows) {
        entities.push(
          repo.create({
            backorderUpload: { id: upload.id } as BackorderUpload,
            sheetName: sheet.sheetName,
            sheetIndex: sheet.sheetIndex,
            rowIndex: row.rowIndex,
            rawRowData: row.cells,
          }),
        );
      }
    }
    if (entities.length > 0) {
      await repo.save(entities, { chunk: SNAPSHOT_INSERT_CHUNK });
    }
    return entities.length;
  }

  /**
   * The archived raw rows of one upload, written back into a workbook: the
   * same sheets in the same order, each cell at its original row/column.
   * Values only — formulas come back as the cached result they had, and
   * formatting is not archived.
   */
  async exportSnapshot(
    uploadId: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const upload = await this.repo.findOne({ where: { id: uploadId } });
    if (!upload) {
      throw new NotFoundException(
        apiError("NOT_FOUND", `BackorderUpload ${uploadId} not found`),
      );
    }
    const stored = await this.dataSource.manager
      .getRepository(BackorderUploadSnapshot)
      .find({ where: { backorderUpload: { id: uploadId } } });

    const sheetsByIndex = new Map<number, SnapshotSheet>();
    for (const row of stored) {
      let sheet = sheetsByIndex.get(row.sheetIndex);
      if (!sheet) {
        sheet = {
          sheetName: row.sheetName,
          sheetIndex: row.sheetIndex,
          rows: [],
        };
        sheetsByIndex.set(row.sheetIndex, sheet);
      }
      sheet.rows.push({ rowIndex: row.rowIndex, cells: row.rawRowData });
    }

    const workbook = buildSnapshotWorkbook([...sheetsByIndex.values()]);
    if (workbook.worksheets.length === 0) {
      // A workbook with no sheet is not a valid .xlsx.
      workbook.addWorksheet("empty");
    }
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      fileName: `Backorder_snapshot_${formatDateForFilename(upload.uploadedAt)}_${upload.id.slice(0, 8)}.xlsx`,
    };
  }

  /**
   * ops gets the whole active backorder, unscoped. client gets the same
   * export but scoped to their own customer_id — enforced here in the
   * service (`where.customer.id`), not left to a response-shape-sensitive
   * interceptor: this returns a raw Buffer, which
   * @ScopeByCustomer/CustomerScopeInterceptor couldn't meaningfully scope
   * anyway (same reasoning as ProformaInvoicesService.exportXlsx).
   */
  async exportXlsx(
    actor: RequestUser,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const where: FindOptionsWhere<ProformaInvoice> = {
      isArchivedShipped: false,
    };
    if (actor.role === Role.CLIENT) {
      where.customer = { id: actor.customerId ?? undefined };
    }
    const activePis = await this.piRepo.find({
      where,
      relations: ["lineItems"],
      order: { piNumber: "ASC" },
    });
    const [latestUpload] = await this.repo.find({
      order: { uploadedAt: "DESC" },
      take: 1,
    });

    const generatedAt = new Date();
    const workbook = buildBackorderExportWorkbook(
      activePis,
      latestUpload?.uploadedAt ?? null,
      generatedAt,
    );
    const arrayBuffer = await workbook.xlsx.writeBuffer();

    const sourceDateStr = latestUpload
      ? formatDateForFilename(latestUpload.uploadedAt)
      : "none";
    const fileName = `Backorder_source_${sourceDateStr}_export_${formatDateForFilename(generatedAt)}.xlsx`;

    return { buffer: Buffer.from(arrayBuffer), fileName };
  }
}
