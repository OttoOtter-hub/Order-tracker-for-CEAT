import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAuditLog1790600000000 implements MigrationInterface {
  name = "AddAuditLog1790600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Additive only (a new table), so the previous release keeps working
    // against this schema during the migrate-then-swap window.
    await queryRunner.query(`
      CREATE TABLE "audit_log" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "actor_user_id" uuid NOT NULL,
        "action" varchar(64) NOT NULL,
        "entity_type" varchar(32) NOT NULL,
        "entity_id" varchar(64),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_audit_log_actor" FOREIGN KEY ("actor_user_id")
          REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_audit_log_created_at" ON "audit_log" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_audit_log_entity" ON "audit_log" ("entity_type", "entity_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_audit_log_actor" ON "audit_log" ("actor_user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_audit_log_action" ON "audit_log" ("action")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_log"`);
  }
}
