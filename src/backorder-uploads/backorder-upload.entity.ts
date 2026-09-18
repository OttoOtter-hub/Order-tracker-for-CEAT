import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../common/entities/base.entity";
import { User } from "../users/user.entity";

/** Audit row for one backorder-file import: who uploaded it, how many rows
 * it contained, how many new PI cards it created (createdFrom
 * BACKORDER_ROW), how many existing cards it archived (present before,
 * absent from this snapshot), and how many rows it couldn't read. */
@Entity("backorder_uploads")
export class BackorderUpload extends BaseEntity {
  @Column({ name: "uploaded_at", type: "timestamptz" })
  uploadedAt: Date;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: "uploaded_by" })
  uploadedBy: User;

  @Column({ name: "file_name", type: "varchar" })
  fileName: string;

  @Column({ name: "rows_processed", type: "int", default: 0 })
  rowsProcessed: number;

  @Column({ name: "new_cards_created", type: "int", default: 0 })
  newCardsCreated: number;

  @Column({ name: "cards_archived", type: "int", default: 0 })
  cardsArchived: number;

  @Column({ name: "rows_skipped", type: "int", default: 0 })
  rowsSkipped: number;
}
