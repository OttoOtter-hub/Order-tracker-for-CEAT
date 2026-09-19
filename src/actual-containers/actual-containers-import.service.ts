import { Injectable, NotFoundException } from "@nestjs/common";
import { EntityManager, In } from "typeorm";
import { BackorderUpload } from "../backorder-uploads/backorder-upload.entity";
import { ParsedActualContainersData } from "../backorder-uploads/utils/parse-actual-containers";
import { Customer } from "../customers/customer.entity";
import { CustomersService } from "../customers/customers.service";
import { ProformaInvoice } from "../proforma-invoices/proforma-invoice.entity";
import { ActualContainer } from "./actual-container.entity";
import { ActualContainerLineItem } from "./actual-container-line-item.entity";

export interface ActualContainersImportResult {
  containersCreated: number;
  containersUpdated: number;
  /** Containers that showed up in Dispatch but in no ETD-ETA row, ever — created with no port/vessel/dates. */
  containersWithoutTransportData: number;
  eta15Updated: number;
  /** ETA-15 rows whose container is unknown, so there was nothing to update. */
  eta15Unmatched: number;
  containersReplaced: number;
  dispatchLinesStored: number;
  dispatchRowsSkipped: number;
  cardsShippedQtyChanged: number;
}

const INSERT_CHUNK = 500;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The shipped-container half of a backorder upload, run inside the upload's
 * transaction (the caller passes its EntityManager). Order matters and follows
 * the spec: ETD-ETA upsert, ETA-15 top-up, Dispatch replacement, then the
 * PI-wide shipped_qty recompute.
 */
@Injectable()
export class ActualContainersImportService {
  constructor(private readonly customersService: CustomersService) {}

  async import(
    em: EntityManager,
    data: ParsedActualContainersData,
    upload: BackorderUpload,
  ): Promise<ActualContainersImportResult> {
    const containerRepo = em.getRepository(ActualContainer);
    const lineRepo = em.getRepository(ActualContainerLineItem);
    const result: ActualContainersImportResult = {
      containersCreated: 0,
      containersUpdated: 0,
      containersWithoutTransportData: 0,
      eta15Updated: 0,
      eta15Unmatched: 0,
      containersReplaced: 0,
      dispatchLinesStored: 0,
      dispatchRowsSkipped: data.dispatchRowsSkipped,
      cardsShippedQtyChanged: 0,
    };

    const dispatchByContainer = new Map<string, typeof data.dispatchRows>();
    for (const row of data.dispatchRows) {
      const group = dispatchByContainer.get(row.containerNumber);
      if (group) {
        group.push(row);
      } else {
        dispatchByContainer.set(row.containerNumber, [row]);
      }
    }

    const mentioned = new Set<string>([
      ...data.containers.map((c) => c.containerNumber),
      ...data.eta15.map((c) => c.containerNumber),
      ...dispatchByContainer.keys(),
    ]);

    const known = new Map<string, ActualContainer>();
    if (mentioned.size > 0) {
      const existing = await containerRepo.find({
        where: { containerNumber: In([...mentioned]) },
      });
      for (const container of existing) {
        known.set(container.containerNumber, container);
      }
    }

    // Only look customers up when some container actually has to be created.
    const needsNewContainer =
      data.containers.some((c) => !known.has(c.containerNumber)) ||
      [...dispatchByContainer.keys()].some((n) => !known.has(n));
    const resolveCustomer = needsNewContainer
      ? await this.customerResolver()
      : (): Customer => {
          throw new Error("unreachable: no container to create");
        };
    const touched = new Map<string, ActualContainer>();

    // ETD-ETA: create on first sight, otherwise overwrite the source_* fields
    // only — override_etd / override_eta are never assigned here.
    for (const row of data.containers) {
      let container = known.get(row.containerNumber);
      if (container) {
        result.containersUpdated++;
      } else {
        container = containerRepo.create({
          containerNumber: row.containerNumber,
          customer: resolveCustomer(row.customerCode),
          overrideEtd: null,
          overrideEta: null,
        });
        known.set(row.containerNumber, container);
        result.containersCreated++;
      }
      container.port = row.port;
      container.vesselName = row.vesselName;
      container.sourceEtd = row.sourceEtd;
      container.sourceEta = row.sourceEta;
      container.preshipmentInvoice = row.preshipmentInvoice;
      container.commercialInvoiceNumber = row.commercialInvoiceNumber;
      touched.set(row.containerNumber, container);
    }

    // ETA-15: only the containers in this week's sample; everyone else keeps
    // whatever these fields held (a container that dropped out of the
    // 15-day window is not "un-shipped").
    for (const row of data.eta15) {
      const container = known.get(row.containerNumber);
      if (!container) {
        result.eta15Unmatched++;
        continue;
      }
      container.blNumber = row.blNumber;
      container.currency = row.currency;
      container.invoiceValue =
        row.invoiceValue === null ? null : String(round2(row.invoiceValue));
      container.documentsReleaseStatus = row.documentsReleaseStatus;
      container.telexReleaseDate = row.telexReleaseDate;
      container.paymentReceiptStatus = row.paymentReceiptStatus;
      touched.set(row.containerNumber, container);
      result.eta15Updated++;
    }

    // A container with dispatched lines but no transport row still has real
    // shipped quantities behind it, so it is kept (bare) rather than dropped.
    for (const [containerNumber, rows] of dispatchByContainer) {
      if (known.has(containerNumber)) {
        continue;
      }
      const container = containerRepo.create({
        containerNumber,
        customer: resolveCustomer(rows[0].customerCode),
        overrideEtd: null,
        overrideEta: null,
      });
      known.set(containerNumber, container);
      touched.set(containerNumber, container);
      result.containersWithoutTransportData++;
    }

    // save() only writes columns that differ from the loaded row, so a
    // container whose file data did not change costs nothing here.
    if (touched.size > 0) {
      await containerRepo.save([...touched.values()]);
    }

    // "Last seen" moves for every container any sheet listed, in one
    // statement instead of one UPDATE per container.
    // (an ETA-15 row for a container nobody knows has nothing to mark)
    const seenIds = [...mentioned]
      .filter((n) => known.has(n))
      .map((n) => known.get(n)!.id);
    if (seenIds.length > 0) {
      await containerRepo.update(
        { id: In(seenIds) },
        { lastSeenInUpload: { id: upload.id } as BackorderUpload },
      );
    }

    // Dispatch: full replacement per container, from the union of both
    // Dispatch sheets (33 real containers are split between Radial and Bias).
    if (dispatchByContainer.size > 0) {
      const replacedIds = [...dispatchByContainer.keys()].map(
        (n) => known.get(n)!.id,
      );
      await lineRepo.delete({ actualContainer: { id: In(replacedIds) } });

      const items: ActualContainerLineItem[] = [];
      for (const [containerNumber, rows] of dispatchByContainer) {
        const actualContainer = {
          id: known.get(containerNumber)!.id,
        } as ActualContainer;
        for (const row of rows) {
          items.push(
            lineRepo.create({
              actualContainer,
              piNumber: row.piNumber,
              invoiceNumber: row.invoiceNumber,
              pgiDate: row.pgiDate,
              materialNum: row.materialNum,
              materialDesc: row.materialDesc,
              quantity: String(row.quantity),
              customerOrderRef: row.customerOrderRef,
            }),
          );
        }
      }
      await lineRepo.save(items, { chunk: INSERT_CHUNK });
      result.containersReplaced = dispatchByContainer.size;
      result.dispatchLinesStored = items.length;
    }

    result.cardsShippedQtyChanged = await this.recomputeShippedQty(em);
    return result;
  }

  /**
   * shipped_qty of every card = Σ Quantity of every stored dispatch line with
   * its PI number, over all containers ever seen. A full recompute each time
   * (the Dispatch sheets are cumulative, so an increment would double-count);
   * only cards whose value actually changed are written. Returns how many.
   */
  async recomputeShippedQty(em: EntityManager): Promise<number> {
    const lines = await em.getRepository(ActualContainerLineItem).find({
      select: { piNumber: true, quantity: true },
    });
    const sumByPi = new Map<string, number>();
    for (const line of lines) {
      if (!line.piNumber) {
        continue;
      }
      sumByPi.set(
        line.piNumber,
        (sumByPi.get(line.piNumber) ?? 0) + Number(line.quantity),
      );
    }

    const piRepo = em.getRepository(ProformaInvoice);
    const cards = await piRepo.find({
      select: { id: true, piNumber: true, shippedQty: true },
    });
    let changed = 0;
    for (const card of cards) {
      const target = round2(sumByPi.get(card.piNumber) ?? 0).toFixed(2);
      if (Number(card.shippedQty ?? 0).toFixed(2) !== target) {
        await piRepo.update({ id: card.id }, { shippedQty: target });
        changed++;
      }
    }
    return changed;
  }

  /**
   * Customer of a container: matched by the file's customer code against
   * customers.customer_code, falling back to the first customer exactly like
   * new PI cards do (single-customer pilot — see CustomersService.findFirst).
   */
  private async customerResolver(): Promise<(code: string | null) => Customer> {
    const customers = await this.customersService.findAll();
    const byCode = new Map(customers.map((c) => [c.customerCode, c]));
    const first = [...customers].sort(
      (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt),
    )[0];
    return (code) => {
      const customer = (code ? byCode.get(code) : undefined) ?? first;
      if (!customer) {
        throw new NotFoundException(
          "No customer exists yet — create one before uploading a backorder file",
        );
      }
      return customer;
    };
  }
}
