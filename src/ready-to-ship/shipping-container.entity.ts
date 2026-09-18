import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "../common/entities/base.entity";
import { Customer } from "../customers/customer.entity";
import { User } from "../users/user.entity";
import { ContainerLineAllocation } from "./container-line-allocation.entity";

/**
 * A container slot in the client's "ready to ship" plan. Slots are created
 * empty (ReadyToShipService.ensureInitialContainers) and filled with
 * ContainerLineAllocation rows; is_confirmed freezes the allocations until
 * ops unlock this specific container.
 */
@Entity("shipping_containers")
export class ShippingContainer extends BaseEntity {
  @ManyToOne(() => Customer, { nullable: false })
  @JoinColumn({ name: "customer_id" })
  customer: Customer;

  @Column({ type: "varchar" })
  label: string;

  @Column({ name: "is_confirmed", type: "boolean", default: false })
  isConfirmed: boolean;

  @Column({ name: "confirmed_at", type: "timestamptz", nullable: true })
  confirmedAt: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "confirmed_by" })
  confirmedBy: User | null;

  @OneToMany(
    () => ContainerLineAllocation,
    (allocation) => allocation.container,
  )
  allocations: ContainerLineAllocation[];
}
