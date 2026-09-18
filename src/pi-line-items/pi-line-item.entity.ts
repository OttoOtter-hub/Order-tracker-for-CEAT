import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../common/entities/base.entity";
import { ProformaInvoice } from "../proforma-invoices/proforma-invoice.entity";

/**
 * One row of a PI's line items. Populated either by parsing the uploaded PI
 * file or from a backorder-upload row (see BackorderUpload) — that parsing
 * logic is a later phase; this phase only defines the shape.
 */
@Entity("pi_line_items")
export class PiLineItem extends BaseEntity {
  @ManyToOne(() => ProformaInvoice, (pi) => pi.lineItems, { nullable: false })
  @JoinColumn({ name: "pi_id" })
  pi: ProformaInvoice;

  @Column({ name: "so_number", type: "varchar", nullable: true })
  soNumber: string | null;

  @Column({ name: "material_num", type: "varchar", nullable: true })
  materialNum: string | null;

  @Column({ name: "material_desc", type: "varchar", nullable: true })
  materialDesc: string | null;

  @Column({
    name: "balance_to_be_delivered",
    type: "numeric",
    precision: 14,
    scale: 2,
    nullable: true,
  })
  balanceToBeDelivered: string | null;

  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  quantity: string | null;

  @Column({ type: "numeric", precision: 14, scale: 3, nullable: true })
  mt: string | null;

  @Column({
    name: "load_factor",
    type: "numeric",
    precision: 8,
    scale: 4,
    nullable: true,
  })
  loadFactor: string | null;

  @Column({ type: "numeric", precision: 8, scale: 4, nullable: true })
  loadability: string | null;

  @Column({
    name: "current_week_dispatch_load_factor",
    type: "numeric",
    precision: 8,
    scale: 4,
    nullable: true,
  })
  currentWeekDispatchLoadFactor: string | null;

  @Column({
    name: "current_week_dispatch_qty",
    type: "numeric",
    precision: 14,
    scale: 2,
    nullable: true,
  })
  currentWeekDispatchQty: string | null;

  /**
   * Client's shipment-planning priority for this row — how much of the
   * remaining balance they want prioritized, 0..balanceToBeDelivered.
   * Not nullable (unlike the other numeric columns above, which come from
   * the backorder file and can be genuinely absent): this one is entirely
   * app-owned, always has a value, and defaults to "not prioritized" (0).
   */
  @Column({
    name: "priority_qty",
    type: "numeric",
    precision: 14,
    scale: 2,
    default: 0,
  })
  priorityQty: string;
}
