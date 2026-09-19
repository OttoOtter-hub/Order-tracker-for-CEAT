import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../common/entities/base.entity";
import { BackorderUpload } from "./backorder-upload.entity";
import type { SnapshotCell } from "./utils/snapshot-sheets";

/**
 * One raw row of one sheet of one weekly upload, exactly as it was read from
 * the file. Written for every sheet on every upload and never updated or
 * deleted — the archive of "what the file actually said that week",
 * independent of the current state the same upload overwrites elsewhere
 * (PI line items, actual containers). `rawRowData` is the row's cells by
 * column (index 0 = column A); a date is stored as `{ "$date": ISO }` so an
 * export can tell it from text.
 */
@Entity("backorder_upload_snapshots")
@Index("ix_backorder_upload_snapshots_upload", [
  "backorderUpload",
  "sheetIndex",
  "rowIndex",
])
export class BackorderUploadSnapshot extends BaseEntity {
  @ManyToOne(() => BackorderUpload, { nullable: false })
  @JoinColumn({ name: "backorder_upload_id" })
  backorderUpload: BackorderUpload;

  @Column({ name: "sheet_name", type: "varchar" })
  sheetName: string;

  @Column({ name: "sheet_index", type: "int" })
  sheetIndex: number;

  @Column({ name: "row_index", type: "int" })
  rowIndex: number;

  @Column({ name: "raw_row_data", type: "jsonb" })
  rawRowData: SnapshotCell[];
}
