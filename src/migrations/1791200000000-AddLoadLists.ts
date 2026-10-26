import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 25: the load list status per customer. Additive — a new table; the
 * previous release never reads it, so it keeps working between this
 * migration and the swap.
 *
 * Existing data is mapped so nothing is lost or reopened:
 *   - any position not confirmed yet (a client draft) -> client_editing: the
 *     client keeps working on it and submits it; a rejection rolls back to
 *     the confirmed positions (no CEAT version exists yet);
 *   - positions, all confirmed                         -> confirmed;
 *   - no positions                                     -> draft_ceat.
 */
export class AddLoadLists1791200000000 implements MigrationInterface {
  name = "AddLoadLists1791200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "load_lists" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "customer_id" uuid NOT NULL REFERENCES "customers"("id"),
        "status" varchar(32) NOT NULL,
        "ceat_snapshot" jsonb NULL,
        "client_snapshot" jsonb NULL,
        "sent_at" timestamptz NULL,
        "sent_by" uuid NULL REFERENCES "users"("id"),
        "edit_requested_at" timestamptz NULL,
        "submitted_at" timestamptz NULL,
        "confirmed_at" timestamptz NULL,
        "rejected_at" timestamptz NULL,
        "rejection_comment" text NULL,
        "rejection_adjustments" jsonb NULL,
        CONSTRAINT "uq_load_lists_customer" UNIQUE ("customer_id"),
        CONSTRAINT "chk_load_lists_status" CHECK ("status" IN
          ('draft_ceat', 'sent_to_client', 'client_editing', 'submitted_by_client', 'confirmed'))
      )
    `);
    await queryRunner.query(`
      INSERT INTO "load_lists" ("customer_id", "status", "confirmed_at")
      SELECT c."id",
        CASE
          WHEN bool_or(NOT a."is_locked") THEN 'client_editing'
          WHEN count(a."id") > 0 THEN 'confirmed'
          ELSE 'draft_ceat'
        END,
        max(s."confirmed_at")
      FROM "customers" c
      JOIN "shipping_containers" s ON s."customer_id" = c."id"
      LEFT JOIN "container_line_allocations" a ON a."container_id" = s."id"
      GROUP BY c."id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "load_lists"`);
  }
}
