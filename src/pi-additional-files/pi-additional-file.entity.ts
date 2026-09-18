import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../common/entities/base.entity";
import { ProformaInvoice } from "../proforma-invoices/proforma-invoice.entity";
import { User } from "../users/user.entity";

/** Any file attached to a PI card beyond the PI/signed/replacement slots
 * (e.g. a covering letter, a customs form) — free-form, no status impact. */
@Entity("pi_additional_files")
export class PiAdditionalFile extends BaseEntity {
  @ManyToOne(() => ProformaInvoice, (pi) => pi.additionalFiles, {
    nullable: false,
  })
  @JoinColumn({ name: "pi_id" })
  pi: ProformaInvoice;

  @Column({ name: "file_url", type: "text" })
  fileUrl: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: "uploaded_by" })
  uploadedBy: User;

  @Column({ name: "uploaded_at", type: "timestamptz" })
  uploadedAt: Date;

  @Column({ type: "text", nullable: true })
  description: string | null;
}
