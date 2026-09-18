import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from "typeorm";
import { BaseEntity } from "../common/entities/base.entity";
import { PiLineItem } from "../pi-line-items/pi-line-item.entity";
import { MarkingFile } from "./marking-file.entity";
import { ShippingContainer } from "./shipping-container.entity";

/**
 * How much of one PiLineItem sits in one container. The same line item can
 * appear in several containers (one row per container); the DB enforces one
 * row per (container, line item). Its fill contribution
 * (allocatedQty / loadability) is derived on read, never stored.
 */
@Entity("container_line_allocations")
export class ContainerLineAllocation extends BaseEntity {
  @ManyToOne(() => ShippingContainer, (container) => container.allocations, {
    nullable: false,
  })
  @JoinColumn({ name: "container_id" })
  container: ShippingContainer;

  @ManyToOne(() => PiLineItem, { nullable: false })
  @JoinColumn({ name: "pi_line_item_id" })
  piLineItem: PiLineItem;

  @Column({
    name: "allocated_qty",
    type: "numeric",
    precision: 14,
    scale: 2,
  })
  allocatedQty: string;

  @OneToOne(() => MarkingFile, (marking) => marking.allocation)
  markingFile: MarkingFile | null;
}
