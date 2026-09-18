import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { FindOptionsWhere, Repository } from "typeorm";
import { CustomersService } from "../customers/customers.service";
import { FilesService } from "../files/files.service";
import { RequestUser } from "../common/auth/request-user.interface";
import { Role } from "../common/enums/role.enum";
import { User } from "../users/user.entity";
import { PiLineItem } from "../pi-line-items/pi-line-item.entity";
import { ProformaInvoice } from "../proforma-invoices/proforma-invoice.entity";
import { PiCreatedFrom } from "../proforma-invoices/enums/pi-created-from.enum";
import { BackorderUpload } from "./backorder-upload.entity";
import { BackorderUploadResultDto } from "./dto/backorder-upload-result.dto";
import {
  ParsedBackorderRow,
  parseBackorderFile,
} from "./utils/parse-backorder-file";
import { computePiAggregates } from "./utils/compute-pi-aggregates";
import { stampDateOnFilename } from "./utils/stamp-date-on-filename";
import { buildBackorderExportWorkbook } from "./utils/build-backorder-export-workbook";
import { formatDateForFilename } from "../common/utils/format-date";
import { toNumberOrNull } from "../common/utils/numeric";

function numToStr(value: number | null): string | null {
  return value === null ? null : String(value);
}

/**
 * Carries a client's priorityQty across a re-upload: old and new rows for
 * the same card are matched by (materialNum, soNumber) — the pair that
 * identifies "the same line" week to week, since line items have no other
 * stable id across uploads (they're deleted and recreated wholesale, see
 * upload() below). A single space joins the two fields into one map key;
 * good enough here since the two are compared as a pair either way and
 * this is only ever used to look itself back up, never parsed apart.
 */
function lineItemKey(
  materialNum: string | null,
  soNumber: string | null,
): string {
  return `${materialNum ?? ""} ${soNumber ?? ""}`;
}

@Injectable()
export class BackorderUploadsService {
  constructor(
    @InjectRepository(BackorderUpload)
    private readonly repo: Repository<BackorderUpload>,
    @InjectRepository(ProformaInvoice)
    private readonly piRepo: Repository<ProformaInvoice>,
    @InjectRepository(PiLineItem)
    private readonly lineItemsRepo: Repository<PiLineItem>,
    private readonly customersService: CustomersService,
    private readonly filesService: FilesService,
  ) {}

  findAll(): Promise<BackorderUpload[]> {
    return this.repo.find({
      relations: ["uploadedBy"],
      order: { uploadedAt: "DESC" },
    });
  }

  /**
   * Parses "Radial BO"/"Bias BO" (see parseBackorderFile — every other
   * sheet in the source workbook is ignored), groups rows by PI number
   * (the "Quotation" column), then per PI: creates the card if it doesn't
   * exist yet (createdFrom = BACKORDER_ROW), un-archives it if it was
   * previously archived (it's back in the open backorder, so it isn't
   * "gone" anymore), replaces its line items wholesale with this upload's
   * rows (a re-upload is a fresh snapshot, not an append — otherwise every
   * re-upload would double every line), and recomputes its aggregates
   * (computePiAggregates). Once every card in the upload has been
   * upserted, any card that's *not* in this snapshot and isn't already
   * archived gets archived — the file is the source of truth for "what's
   * still open," so silently dropping out of it means it shipped.
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
      { ...file, originalname: stampDateOnFilename(file.originalname, uploadedAt) },
      actor.id,
    );

    const { rows, skippedRowCount } = await parseBackorderFile(file.buffer);

    const rowsByPiNumber = new Map<string, ParsedBackorderRow[]>();
    for (const row of rows) {
      const group = rowsByPiNumber.get(row.piNumber);
      if (group) {
        group.push(row);
      } else {
        rowsByPiNumber.set(row.piNumber, [row]);
      }
    }

    let newCardsCreated = 0;
    for (const [piNumber, piRows] of rowsByPiNumber) {
      let pi = await this.piRepo.findOne({ where: { piNumber } });
      if (!pi) {
        const customer = await this.customersService.findFirst();
        pi = await this.piRepo.save(
          this.piRepo.create({
            piNumber,
            customer,
            createdFrom: PiCreatedFrom.BACKORDER_ROW,
            isArchivedShipped: false,
          }),
        );
        newCardsCreated++;
      } else if (pi.isArchivedShipped) {
        pi.isArchivedShipped = false;
      }

      const oldLineItems = await this.lineItemsRepo.find({
        where: { pi: { id: pi.id } },
      });
      const oldPriorityByKey = new Map<string, number>();
      for (const old of oldLineItems) {
        oldPriorityByKey.set(
          lineItemKey(old.materialNum, old.soNumber),
          toNumberOrNull(old.priorityQty) ?? 0,
        );
      }

      await this.lineItemsRepo.delete({ pi: { id: pi.id } });
      const lineItems = piRows.map((row) => {
        const newBalance = row.balanceToBeDelivered ?? 0;
        const carriedPriority =
          oldPriorityByKey.get(lineItemKey(row.materialNum, row.soNumber)) ??
          0;
        const priorityQty = Math.min(carriedPriority, newBalance);
        return this.lineItemsRepo.create({
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
          priorityQty: String(priorityQty),
        });
      });
      await this.lineItemsRepo.save(lineItems);

      const agg = computePiAggregates(piRows);
      pi.totalQty = String(agg.totalQty);
      pi.totalContainers = String(agg.totalContainers);
      pi.qtyPending = String(agg.qtyPending);
      pi.containersPending = String(agg.containersPending);
      pi.currentWeekPlanContainers = String(agg.currentWeekPlanContainers);
      pi.currentWeekPlanQty = String(agg.currentWeekPlanQty);
      await this.piRepo.save(pi);
    }

    // Cards missing from this upload's snapshot (and not already
    // archived) are presumed fully shipped. Line items are left alone —
    // they stay as the last known state, per the pilot's own call not to
    // touch them on archival. Pilot-scale row counts (tens of cards), so a
    // plain find + filter + bulk save is plenty — no need for a raw SQL
    // UPDATE.
    const piNumbersInUpload = new Set(rowsByPiNumber.keys());
    const notYetArchived = await this.piRepo.find({
      where: { isArchivedShipped: false },
    });
    const toArchive = notYetArchived.filter(
      (candidate) => !piNumbersInUpload.has(candidate.piNumber),
    );
    for (const candidate of toArchive) {
      candidate.isArchivedShipped = true;
    }
    if (toArchive.length > 0) {
      await this.piRepo.save(toArchive);
    }
    const cardsArchived = toArchive.length;

    const upload = this.repo.create({
      uploadedAt,
      uploadedBy: { id: actor.id } as User,
      fileName: file.originalname,
      rowsProcessed: rows.length,
      newCardsCreated,
      cardsArchived,
      rowsSkipped: skippedRowCount,
    });
    const saved = await this.repo.save(upload);

    return {
      id: saved.id,
      uploadedAt: saved.uploadedAt,
      fileName: saved.fileName,
      rowsProcessed: saved.rowsProcessed,
      newCardsCreated: saved.newCardsCreated,
      cardsUpdated: rowsByPiNumber.size - newCardsCreated,
      cardsArchived: saved.cardsArchived,
      cardsSkippedInvalidRows: saved.rowsSkipped,
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
