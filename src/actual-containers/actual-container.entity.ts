import { Exclude, Expose } from "class-transformer";
import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import { BackorderUpload } from "../backorder-uploads/backorder-upload.entity";
import { BaseEntity } from "../common/entities/base.entity";
import { Customer } from "../customers/customer.entity";
import { User } from "../users/user.entity";
import { ActualContainerFile } from "./actual-container-file.entity";
import { ActualContainerLineItem } from "./actual-container-line-item.entity";
import { daysBetween } from "./utils/days-between";

export type ArrivalStatus = "expected" | "arrived" | null;

// A container counts as "arrived" on its own, without anyone confirming it,
// once this many days have passed since its effective ETA.
const AUTO_ARRIVED_AFTER_DAYS = 7;
// The "expected" marker starts showing this many days before the effective ETA.
const EXPECTED_FROM_DAYS_BEFORE = 10;

/**
 * A container CEAT has actually shipped (or is shipping), known from the
 * weekly file — NOT the client's planning ShippingContainer of the
 * ready-to-ship section; the two are unrelated. Calendar dates are `date`
 * columns and travel as "YYYY-MM-DD" strings.
 */
@Entity("actual_containers")
export class ActualContainer extends BaseEntity {
  @Column({ name: "container_number", type: "varchar", unique: true })
  containerNumber: string;

  @ManyToOne(() => Customer, { nullable: false })
  @JoinColumn({ name: "customer_id" })
  customer: Customer;

  // From the file, rewritten on every upload that lists the container.
  @Column({ type: "varchar", nullable: true })
  port: string | null;

  @Column({ name: "vessel_name", type: "varchar", nullable: true })
  vesselName: string | null;

  @Column({ name: "source_etd", type: "date", nullable: true })
  sourceEtd: string | null;

  @Column({ name: "source_eta", type: "date", nullable: true })
  sourceEta: string | null;

  @Column({ name: "preshipment_invoice", type: "varchar", nullable: true })
  preshipmentInvoice: string | null;

  @Column({
    name: "commercial_invoice_number",
    type: "varchar",
    nullable: true,
  })
  commercialInvoiceNumber: string | null;

  // Typed in by CEAT; an upload never touches these, only reset-dates does.
  @Column({ name: "override_etd", type: "date", nullable: true })
  overrideEtd: string | null;

  @Column({ name: "override_eta", type: "date", nullable: true })
  overrideEta: string | null;

  // From "ETA-15 days": only present for the containers in that week's
  // sample, and kept as they were when a later upload's sample omits them.
  @Column({ name: "bl_number", type: "varchar", nullable: true })
  blNumber: string | null;

  @Column({ type: "varchar", nullable: true })
  currency: string | null;

  @Column({
    name: "invoice_value",
    type: "numeric",
    precision: 16,
    scale: 2,
    nullable: true,
  })
  invoiceValue: string | null;

  @Column({ name: "documents_release_status", type: "varchar", nullable: true })
  documentsReleaseStatus: string | null;

  @Column({ name: "telex_release_date", type: "date", nullable: true })
  telexReleaseDate: string | null;

  @Column({ name: "payment_receipt_status", type: "varchar", nullable: true })
  paymentReceiptStatus: string | null;

  // Set only by POST /:id/confirm-arrival (client). Never touched by an
  // upload or by the automatic ("7+ days after ETA") side of arrivalStatus
  // below — that one is computed, not stored.
  @Column({ name: "arrival_confirmed_at", type: "timestamptz", nullable: true })
  arrivalConfirmedAt: Date | null;

  // Raw relation, kept out of JSON — the API exposes only the confirmer's
  // email, via the arrivalConfirmedBy getter below.
  @Exclude({ toPlainOnly: true })
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "arrival_confirmed_by" })
  arrivalConfirmedByUser: User | null;

  // Set once, the first time ArrivalNotificationsService's daily cron sees
  // this container's arrivalStatus as "expected" — never reset afterwards,
  // so it doubles as "has this container ever been notified" and the cron
  // never re-sends on later runs while the status stays "expected". Internal
  // bookkeeping, not part of the API response.
  @Exclude({ toPlainOnly: true })
  @Column({
    name: "arrival_notification_sent_at",
    type: "timestamptz",
    nullable: true,
  })
  arrivalNotificationSentAt: Date | null;

  @ManyToOne(() => BackorderUpload, { nullable: true })
  @JoinColumn({ name: "last_seen_in_upload_id" })
  lastSeenInUpload: BackorderUpload | null;

  @OneToMany(() => ActualContainerLineItem, (item) => item.actualContainer)
  lineItems: ActualContainerLineItem[];

  @OneToMany(() => ActualContainerFile, (file) => file.actualContainer)
  files: ActualContainerFile[];

  // Not a column: the service fills it in on every read (the list carries only
  // this number, not the files themselves; the detail has both).
  filesCount?: number;

  /** What to show: CEAT's manual date if set, otherwise the file's. */
  @Expose()
  get etd(): string | null {
    return this.overrideEtd ?? this.sourceEtd;
  }

  @Expose()
  get eta(): string | null {
    return this.overrideEta ?? this.sourceEta;
  }

  @Expose()
  get isEtdOverridden(): boolean {
    return this.overrideEtd !== null && this.overrideEtd !== undefined;
  }

  @Expose()
  get isEtaOverridden(): boolean {
    return this.overrideEta !== null && this.overrideEta !== undefined;
  }

  /**
   * Computed fresh on every read from today's date — never stored, so it
   * can never drift from `arrival_confirmed_at` or go stale between uploads.
   *   - null: no ETA, or more than 10 days still remain until it.
   *   - "expected": ETA is 0–10 days away, or passed less than 7 days ago,
   *     and nobody has confirmed arrival yet.
   *   - "arrived": arrival was confirmed manually, OR 7+ days have passed
   *     since the ETA (arrived on its own, without confirmation).
   */
  @Expose()
  get arrivalStatus(): ArrivalStatus {
    if (this.arrivalConfirmedAt) {
      return "arrived";
    }
    if (!this.eta) {
      return null;
    }
    const daysSinceEta = daysBetween(this.eta, new Date().toISOString());
    if (daysSinceEta >= AUTO_ARRIVED_AFTER_DAYS) {
      return "arrived";
    }
    return daysSinceEta >= -EXPECTED_FROM_DAYS_BEFORE ? "expected" : null;
  }

  /** The confirming client's email, only when arrival was confirmed manually. */
  @Expose()
  get arrivalConfirmedBy(): string | null {
    return this.arrivalConfirmedByUser?.email ?? null;
  }
}
