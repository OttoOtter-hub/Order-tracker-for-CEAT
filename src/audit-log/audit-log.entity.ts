import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "../users/user.entity";

/**
 * One row per recorded action (Phase 20b) — append-only: nothing updates or
 * deletes these, so there is no updated_at. `metadata` holds whatever
 * details the action has (old/new values, file names, quantities, the PI
 * number to show…), written once by AuditService.record.
 */
@Entity("audit_log")
@Index("ix_audit_log_created_at", ["createdAt"])
@Index("ix_audit_log_entity", ["entityType", "entityId"])
@Index("ix_audit_log_actor", ["actor"])
@Index("ix_audit_log_action", ["action"])
export class AuditLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: "actor_user_id" })
  actor: User;

  @Column({ type: "varchar", length: 64 })
  action: string;

  @Column({ name: "entity_type", type: "varchar", length: 32 })
  entityType: string;

  @Column({ name: "entity_id", type: "varchar", length: 64, nullable: true })
  entityId: string | null;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
