import { Expose } from "class-transformer";
import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "../common/entities/base.entity";
import { Customer } from "../customers/customer.entity";
import { User } from "../users/user.entity";
import { PiAdditionalFile } from "../pi-additional-files/pi-additional-file.entity";
import { PiLineItem } from "../pi-line-items/pi-line-item.entity";
import { PiCreatedFrom } from "./enums/pi-created-from.enum";
import { PiStatus } from "./enums/pi-status.enum";
import { computePriorityAggregates } from "./utils/compute-priority-aggregates";

@Entity("proforma_invoices")
export class ProformaInvoice extends BaseEntity {
  @Column({ name: "pi_number", type: "varchar", unique: true })
  piNumber: string;

  @ManyToOne(() => Customer, { nullable: false })
  @JoinColumn({ name: "customer_id" })
  customer: Customer;

  @Column({ name: "pi_file_url", type: "text", nullable: true })
  piFileUrl: string | null;

  @Column({
    name: "pi_file_uploaded_at",
    type: "timestamptz",
    nullable: true,
  })
  piFileUploadedAt: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "pi_file_uploaded_by" })
  piFileUploadedBy: User | null;

  @Column({ name: "signed_file_url", type: "text", nullable: true })
  signedFileUrl: string | null;

  @Column({
    name: "signed_file_uploaded_at",
    type: "timestamptz",
    nullable: true,
  })
  signedFileUploadedAt: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "signed_file_uploaded_by" })
  signedFileUploadedBy: User | null;

  @Column({
    name: "pending_replacement_file_url",
    type: "text",
    nullable: true,
  })
  pendingReplacementFileUrl: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "pending_replacement_proposed_by" })
  pendingReplacementProposedBy: User | null;

  @Column({
    name: "pending_replacement_proposed_at",
    type: "timestamptz",
    nullable: true,
  })
  pendingReplacementProposedAt: Date | null;

  @Column({ name: "is_archived_shipped", type: "boolean", default: false })
  isArchivedShipped: boolean;

  @Column({
    name: "created_from",
    type: "enum",
    enum: PiCreatedFrom,
    enumName: "pi_created_from_enum",
  })
  createdFrom: PiCreatedFrom;

  @Column({
    name: "total_qty",
    type: "numeric",
    precision: 14,
    scale: 2,
    nullable: true,
  })
  totalQty: string | null;

  @Column({
    name: "total_containers",
    type: "numeric",
    precision: 14,
    scale: 2,
    nullable: true,
  })
  totalContainers: string | null;

  @Column({
    name: "qty_pending",
    type: "numeric",
    precision: 14,
    scale: 2,
    nullable: true,
  })
  qtyPending: string | null;

  @Column({
    name: "containers_pending",
    type: "numeric",
    precision: 14,
    scale: 2,
    nullable: true,
  })
  containersPending: string | null;

  @Column({
    name: "current_week_plan_containers",
    type: "numeric",
    precision: 14,
    scale: 2,
    nullable: true,
  })
  currentWeekPlanContainers: string | null;

  @Column({
    name: "current_week_plan_qty",
    type: "numeric",
    precision: 14,
    scale: 2,
    nullable: true,
  })
  currentWeekPlanQty: string | null;

  @OneToMany(() => PiAdditionalFile, (file) => file.pi)
  additionalFiles: PiAdditionalFile[];

  @OneToMany(() => PiLineItem, (item) => item.pi)
  lineItems: PiLineItem[];

  /**
   * Derived, never stored: the card's lifecycle stage is fully determined
   * by which files exist and the archived flag, so computing it here keeps
   * it always consistent with those fields instead of risking drift from a
   * manually-set status column that some write path forgets to update.
   */
  @Expose()
  get status(): PiStatus {
    if (this.isArchivedShipped) {
      return PiStatus.ARCHIVED_SHIPPED;
    }
    if (this.pendingReplacementFileUrl) {
      return PiStatus.REPLACEMENT_PENDING;
    }
    if (this.signedFileUrl) {
      return PiStatus.SIGNED;
    }
    if (this.piFileUrl) {
      return PiStatus.MISSING_SIGNED_DOCUMENT;
    }
    return PiStatus.MISSING_PI_DOCUMENT;
  }

  /**
   * Live, not persisted — unlike totalQty/totalContainers (snapshotted at
   * upload time), priorityQty changes independently whenever the client
   * edits it, so these are recomputed from the loaded lineItems on every
   * read instead of risking a stored value drifting from the real rows.
   * Requires lineItems to be loaded (every current caller — findAll/findOne
   * — already does); falls back to 0 rather than throwing if it isn't.
   */
  @Expose()
  get priorityTotalQty(): number {
    return computePriorityAggregates(this.lineItems ?? []).priorityTotalQty;
  }

  @Expose()
  get priorityTotalContainers(): number {
    return computePriorityAggregates(this.lineItems ?? [])
      .priorityTotalContainers;
  }
}
