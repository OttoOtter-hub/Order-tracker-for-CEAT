import { Exclude } from "class-transformer";
import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../common/entities/base.entity";
import { Role } from "../common/enums/role.enum";
import { Customer } from "../customers/customer.entity";

@Entity("users")
export class User extends BaseEntity {
  @Column({ type: "varchar", unique: true })
  email: string;

  /**
   * v2 note: ProformaInvoice now nests User (uploaded/proposed-by) in its
   * own API responses via the global ClassSerializerInterceptor — this
   * wasn't reachable pre-v2 (User was never nested in any response), so it
   * needs an explicit @Exclude here to keep the bcrypt hash out of JSON.
   */
  @Exclude({ toPlainOnly: true })
  @Column({ name: "password_hash", type: "varchar" })
  passwordHash: string;

  @Column({
    type: "enum",
    enum: Role,
    enumName: "user_role_enum",
  })
  role: Role;

  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn({ name: "customer_id" })
  customer: Customer | null;

  /**
   * Deactivated users are never deleted (they stay the uploader/confirmer on
   * existing records): they can't log in, their tokens stop working (see
   * JwtStrategy) and they get no notification emails.
   */
  @Column({ name: "is_active", type: "boolean", default: true })
  isActive: boolean;

  /**
   * An ops user who may also manage users and read the action log. Only
   * ever true for role=ops (a DB check constraint enforces it); for a
   * client it means nothing.
   */
  @Column({ name: "is_admin", type: "boolean", default: false })
  isAdmin: boolean;
}
