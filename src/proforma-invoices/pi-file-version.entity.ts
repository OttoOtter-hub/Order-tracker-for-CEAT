import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../common/entities/base.entity";
import { User } from "../users/user.entity";
import { ProformaInvoice } from "./proforma-invoice.entity";

export enum PiFileType {
  ORIGINAL = "original",
  SIGNED = "signed",
}

/**
 * A version of a PI's original or signed file that has been replaced
 * (Phase 19). Written right before pi_file_url / signed_file_url is
 * overwritten with a new value, carrying the *old* value and who/when
 * uploaded it; the current file itself stays on the PI row and is never
 * duplicated here. A first upload has nothing to archive.
 *
 * `replacedAt` is when this version stopped being current. Every stored row
 * has it; null is what the history endpoint uses for the current version,
 * which it builds from the PI's own fields (see
 * ProformaInvoicesService.getFileHistory).
 */
@Entity("pi_file_versions")
export class PiFileVersion extends BaseEntity {
  @ManyToOne(() => ProformaInvoice, { nullable: false })
  @JoinColumn({ name: "pi_id" })
  pi: ProformaInvoice;

  @Column({
    name: "file_type",
    type: "enum",
    enum: PiFileType,
    enumName: "pi_file_type_enum",
  })
  fileType: PiFileType;

  @Column({ name: "file_url", type: "text" })
  fileUrl: string;

  // Nullable: cards filled in before the *_uploaded_by columns existed can
  // have a file with no recorded uploader.
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "uploaded_by" })
  uploadedBy: User | null;

  @Column({ name: "uploaded_at", type: "timestamptz", nullable: true })
  uploadedAt: Date | null;

  @Column({ name: "replaced_at", type: "timestamptz", nullable: true })
  replacedAt: Date | null;
}
