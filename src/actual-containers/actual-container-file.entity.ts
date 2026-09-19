import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../common/entities/base.entity";
import { User } from "../users/user.entity";
import { ActualContainer } from "./actual-container.entity";

/**
 * A document attached to an actual container by CEAT (packing list, photos,
 * marking — anything; deliberately untyped). One flat list per container.
 * `fileName` repeats the original name so the list can be shown without
 * resolving the stored file.
 */
@Entity("actual_container_files")
export class ActualContainerFile extends BaseEntity {
  @ManyToOne(() => ActualContainer, (container) => container.files, {
    nullable: false,
  })
  @JoinColumn({ name: "actual_container_id" })
  actualContainer: ActualContainer;

  @Column({ name: "file_url", type: "text" })
  fileUrl: string;

  @Column({ name: "file_name", type: "varchar" })
  fileName: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: "uploaded_by" })
  uploadedBy: User;

  @Column({ name: "uploaded_at", type: "timestamptz" })
  uploadedAt: Date;

  @Column({ type: "text", nullable: true })
  description: string | null;
}
