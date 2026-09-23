import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPiFileVersions1790400000000 implements MigrationInterface {
  name = "AddPiFileVersions1790400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Additive only (a new type and a new table), so the previous release
    // keeps working against this schema during the migrate-then-swap window.
    await queryRunner.query(
      `CREATE TYPE "pi_file_type_enum" AS ENUM ('original', 'signed')`,
    );
    await queryRunner.query(`
      CREATE TABLE "pi_file_versions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "pi_id" uuid NOT NULL,
        "file_type" "pi_file_type_enum" NOT NULL,
        "file_url" text NOT NULL,
        "uploaded_by" uuid,
        "uploaded_at" timestamptz,
        "replaced_at" timestamptz,
        CONSTRAINT "fk_pi_file_versions_pi" FOREIGN KEY ("pi_id")
          REFERENCES "proforma_invoices" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_pi_file_versions_uploaded_by" FOREIGN KEY ("uploaded_by")
          REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_pi_file_versions_pi" ON "pi_file_versions" ("pi_id", "file_type")`,
    );
    // The client-side download check looks archived files up by URL.
    await queryRunner.query(
      `CREATE INDEX "ix_pi_file_versions_file_url" ON "pi_file_versions" ("file_url")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "pi_file_versions"`);
    await queryRunner.query(`DROP TYPE "pi_file_type_enum"`);
  }
}
