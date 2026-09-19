import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../common/entities/base.entity";
import { ActualContainer } from "./actual-container.entity";

/**
 * One dispatched line of an actual container (a row of Radial/Bias Dispatch).
 * `piNumber` is deliberately not a foreign key: a historical container can
 * belong to a PI that has no card any more (or never had one here).
 * Replaced wholesale for a container on every upload that lists it.
 */
@Entity("actual_container_line_items")
@Index("ix_actual_container_line_items_pi_number", ["piNumber"])
@Index("ix_actual_container_line_items_container", ["actualContainer"])
export class ActualContainerLineItem extends BaseEntity {
  @ManyToOne(() => ActualContainer, (container) => container.lineItems, {
    nullable: false,
  })
  @JoinColumn({ name: "actual_container_id" })
  actualContainer: ActualContainer;

  @Column({ name: "pi_number", type: "varchar", nullable: true })
  piNumber: string | null;

  @Column({ name: "invoice_number", type: "varchar", nullable: true })
  invoiceNumber: string | null;

  @Column({ name: "pgi_date", type: "date", nullable: true })
  pgiDate: string | null;

  @Column({ name: "material_num", type: "varchar", nullable: true })
  materialNum: string | null;

  @Column({ name: "material_desc", type: "varchar", nullable: true })
  materialDesc: string | null;

  @Column({ type: "numeric", precision: 14, scale: 2 })
  quantity: string;

  @Column({ name: "customer_order_ref", type: "varchar", nullable: true })
  customerOrderRef: string | null;
}
