import { Column, Entity } from "typeorm";
import { BaseEntity } from "../common/entities/base.entity";

/**
 * Local-disk-backed file storage (see FilesService). `storageKey` is
 * deliberately separate from `id` even though today it's always
 * `${id}${ext}` — keeps the door open for a future S3-compatible backend
 * (TOR allowed either) without a schema change, since an S3 object key
 * wouldn't necessarily match the row id.
 */
@Entity("stored_files")
export class StoredFile extends BaseEntity {
  @Column({ name: "original_name", type: "varchar" })
  originalName: string;

  @Column({ name: "mime_type", type: "varchar" })
  mimeType: string;

  @Column({ name: "size_bytes", type: "bigint" })
  sizeBytes: string;

  @Column({ name: "storage_key", type: "varchar" })
  storageKey: string;

  @Column({ name: "uploaded_by", type: "varchar" })
  uploadedBy: string;
}
