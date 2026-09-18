import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from "typeorm";
import { BaseEntity } from "../common/entities/base.entity";
import { User } from "../users/user.entity";
import { ContainerLineAllocation } from "./container-line-allocation.entity";

/**
 * The single marking document for one allocation row (SKU + container).
 * Unique on the allocation: replacing a file means deleting this row and
 * creating a new one.
 */
@Entity("marking_files")
export class MarkingFile extends BaseEntity {
  @OneToOne(
    () => ContainerLineAllocation,
    (allocation) => allocation.markingFile,
    {
      nullable: false,
    },
  )
  @JoinColumn({ name: "container_line_allocation_id" })
  allocation: ContainerLineAllocation;

  @Column({ name: "file_url", type: "text" })
  fileUrl: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: "uploaded_by" })
  uploadedBy: User;

  @Column({ name: "uploaded_at", type: "timestamptz" })
  uploadedAt: Date;
}
