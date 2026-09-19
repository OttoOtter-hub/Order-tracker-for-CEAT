import { Expose } from "class-transformer";
import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import { BackorderUpload } from "../backorder-uploads/backorder-upload.entity";
import { BaseEntity } from "../common/entities/base.entity";
import { Customer } from "../customers/customer.entity";
import { ActualContainerFile } from "./actual-container-file.entity";
import { ActualContainerLineItem } from "./actual-container-line-item.entity";

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

  @ManyToOne(() => BackorderUpload, { nullable: true })
  @JoinColumn({ name: "last_seen_in_upload_id" })
  lastSeenInUpload: BackorderUpload | null;

  @OneToMany(() => ActualContainerLineItem, (item) => item.actualContainer)
  lineItems: ActualContainerLineItem[];

  @OneToMany(() => ActualContainerFile, (file) => file.actualContainer)
  files: ActualContainerFile[];

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
}
