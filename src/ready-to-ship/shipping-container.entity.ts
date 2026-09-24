import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "../common/entities/base.entity";
import { Customer } from "../customers/customer.entity";
import { User } from "../users/user.entity";
import { ContainerLineAllocation } from "./container-line-allocation.entity";

/**
 * A container slot in the client's "ready to ship" plan. Slots are created
 * empty (ReadyToShipService.ensureContainerSlots) and filled with
 * ContainerLineAllocation rows.
 *
 * Phase 16: locking is per-position now (ContainerLineAllocation.isLocked),
 * not a single flag here — ops can free one line without touching the rest
 * of the container. This entity has no "is confirmed" of its own any more;
 * ReadyToShipService.loadView derives it from the container's own
 * allocations (fully locked = confirmed, a mix = partially unlocked). The
 * underlying is_confirmed DB column still physically exists (left alone by
 * the Phase 16 migration for zero-downtime deploy safety) but nothing reads
 * or writes it any more.
 */
@Entity("shipping_containers")
export class ShippingContainer extends BaseEntity {
  @ManyToOne(() => Customer, { nullable: false })
  @JoinColumn({ name: "customer_id" })
  customer: Customer;

  @Column({ type: "varchar" })
  label: string;

  /**
   * Phase 21: the customer's single "OK to mix" container — lines that ship
   * mixed rather than in a numbered, loadability-planned slot. Created lazily
   * with the fixed label "OK to mix", never counted as a slot of the plan
   * (totalPossibleContainers), never overfilled (no fill percent at all), and
   * the only place a line without loadability can go. Confirm, unlocks,
   * undo and marking files treat it like any other container.
   */
  @Column({ name: "is_ok_to_mix", type: "boolean", default: false })
  isOkToMix: boolean;

  /** Stamped by the last confirm() that touched (any of) this container's positions. */
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
