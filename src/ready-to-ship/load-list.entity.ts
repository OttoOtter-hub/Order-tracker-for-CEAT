import { Column, Entity } from "typeorm";
import { BaseEntity } from "../common/entities/base.entity";
import type { LoadListAdjustment, LoadListSnapshot } from "./load-list.types";

/**
 * Phase 25: who may change the customer's "Ready to ship" layout right now.
 *
 *   draft_ceat ──send──> sent_to_client ──accept──────────────> confirmed
 *        ^                 │      ^                                  │
 *        │          request-edit  └──reject── submitted_by_client    │
 *        │                 v                     ^       │approve    │
 *        │            client_editing ──submit────┘       v           │
 *        └──────── reopen / any ops unlock ───────── confirmed <─────┘
 *
 * There is no stored "edit_requested": the client's request opens editing
 * at once (and tells CEAT), so it would never be seen.
 */
export enum LoadListStatus {
  DRAFT_CEAT = "draft_ceat",
  SENT_TO_CLIENT = "sent_to_client",
  CLIENT_EDITING = "client_editing",
  SUBMITTED_BY_CLIENT = "submitted_by_client",
  CONFIRMED = "confirmed",
}

/**
 * One row per customer: the status of the customer's whole current set of
 * containers, plus the last version CEAT sent and the last one the client
 * submitted (container -> lines -> qty), kept for rollback and comparison.
 * Earlier rounds live on in the action journal.
 */
@Entity("load_lists")
export class LoadList extends BaseEntity {
  // Plain columns rather than relations: the row is read FOR UPDATE on every
  // edit, and Postgres refuses that lock across the outer join a relation
  // would add.
  @Column({ name: "customer_id", type: "uuid" })
  customerId: string;

  @Column({ type: "varchar", length: 32 })
  status: LoadListStatus;

  @Column({ name: "ceat_snapshot", type: "jsonb", nullable: true })
  ceatSnapshot: LoadListSnapshot | null;

  @Column({ name: "client_snapshot", type: "jsonb", nullable: true })
  clientSnapshot: LoadListSnapshot | null;

  @Column({ name: "sent_at", type: "timestamptz", nullable: true })
  sentAt: Date | null;

  @Column({ name: "sent_by", type: "uuid", nullable: true })
  sentById: string | null;

  @Column({ name: "edit_requested_at", type: "timestamptz", nullable: true })
  editRequestedAt: Date | null;

  @Column({ name: "submitted_at", type: "timestamptz", nullable: true })
  submittedAt: Date | null;

  @Column({ name: "confirmed_at", type: "timestamptz", nullable: true })
  confirmedAt: Date | null;

  @Column({ name: "rejected_at", type: "timestamptz", nullable: true })
  rejectedAt: Date | null;

  /** CEAT's comment on the last rejected client version (shown to the client). */
  @Column({ name: "rejection_comment", type: "text", nullable: true })
  rejectionComment: string | null;

  /** What the rollback to CEAT's version had to cut to the current stock. */
  @Column({ name: "rejection_adjustments", type: "jsonb", nullable: true })
  rejectionAdjustments: LoadListAdjustment[] | null;
}
