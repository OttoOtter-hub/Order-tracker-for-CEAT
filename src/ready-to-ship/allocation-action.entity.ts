import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../common/entities/base.entity";
import { Customer } from "../customers/customer.entity";
import { PiLineItem } from "../pi-line-items/pi-line-item.entity";
import { ShippingContainer } from "./shipping-container.entity";

/**
 * Undo log: one row per successful "move", so "undo last" / "undo all" can
 * roll allocations back. Undoing deletes the action row rather than logging
 * a compensating negative one, so the actions of a container always sum to
 * its allocations' quantities.
 */
@Entity("allocation_actions")
export class AllocationAction extends BaseEntity {
  @ManyToOne(() => Customer, { nullable: false })
  @JoinColumn({ name: "customer_id" })
  customer: Customer;

  @ManyToOne(() => ShippingContainer, { nullable: false })
  @JoinColumn({ name: "container_id" })
  container: ShippingContainer;

  @ManyToOne(() => PiLineItem, { nullable: false })
  @JoinColumn({ name: "pi_line_item_id" })
  piLineItem: PiLineItem;

  @Column({ name: "delta_qty", type: "numeric", precision: 14, scale: 2 })
  deltaQty: string;
}
