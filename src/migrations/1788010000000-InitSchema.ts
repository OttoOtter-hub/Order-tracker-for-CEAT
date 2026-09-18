import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * v2 clean rebuild: this is the only migration in the repo. It does not
 * migrate v1's data — the pilot's v1 tables are dropped by hand before this
 * runs (see README "Rebuilding the schema (v2)"). Everything below is a
 * fresh `up`, not a diff against the old schema.
 */
export class InitSchema1788010000000 implements MigrationInterface {
  name = "InitSchema1788010000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await queryRunner.query(
      `CREATE TYPE "payment_terms_enum" AS ENUM ('prepayment_100', 'advance_30', 'copy_docs_100')`,
    );
    await queryRunner.query(
      `CREATE TYPE "user_role_enum" AS ENUM ('ops', 'client')`,
    );
    await queryRunner.query(
      `CREATE TYPE "pi_created_from_enum" AS ENUM ('pi_upload', 'backorder_row')`,
    );

    await queryRunner.query(`
      CREATE TABLE "customers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "name" varchar NOT NULL,
        "customer_code" varchar NOT NULL,
        "tax_id" varchar,
        "address" text,
        "default_port" varchar,
        "default_payment_terms" "payment_terms_enum",
        CONSTRAINT "uq_customers_customer_code" UNIQUE ("customer_code")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "email" varchar NOT NULL,
        "password_hash" varchar NOT NULL,
        "role" "user_role_enum" NOT NULL,
        "customer_id" uuid,
        CONSTRAINT "uq_users_email" UNIQUE ("email"),
        CONSTRAINT "fk_users_customer" FOREIGN KEY ("customer_id")
          REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "chk_users_client_has_customer" CHECK (
          (role = 'client' AND customer_id IS NOT NULL) OR (role = 'ops')
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "proforma_invoices" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "pi_number" varchar NOT NULL,
        "customer_id" uuid NOT NULL,
        "pi_file_url" text,
        "pi_file_uploaded_at" timestamptz,
        "pi_file_uploaded_by" uuid,
        "signed_file_url" text,
        "signed_file_uploaded_at" timestamptz,
        "signed_file_uploaded_by" uuid,
        "pending_replacement_file_url" text,
        "pending_replacement_proposed_by" uuid,
        "pending_replacement_proposed_at" timestamptz,
        "is_archived_shipped" boolean NOT NULL DEFAULT false,
        "created_from" "pi_created_from_enum" NOT NULL,
        "total_qty" numeric(14,2),
        "total_containers" numeric(14,2),
        "qty_pending" numeric(14,2),
        "containers_pending" numeric(14,2),
        "current_week_plan_containers" numeric(14,2),
        "current_week_plan_qty" numeric(14,2),
        CONSTRAINT "uq_proforma_invoices_pi_number" UNIQUE ("pi_number"),
        CONSTRAINT "fk_proforma_invoices_customer" FOREIGN KEY ("customer_id")
          REFERENCES "customers" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_proforma_invoices_pi_file_uploaded_by" FOREIGN KEY ("pi_file_uploaded_by")
          REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_proforma_invoices_signed_file_uploaded_by" FOREIGN KEY ("signed_file_uploaded_by")
          REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_proforma_invoices_pending_replacement_proposed_by" FOREIGN KEY ("pending_replacement_proposed_by")
          REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "pi_additional_files" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "pi_id" uuid NOT NULL,
        "file_url" text NOT NULL,
        "uploaded_by" uuid NOT NULL,
        "uploaded_at" timestamptz NOT NULL DEFAULT now(),
        "description" text,
        CONSTRAINT "fk_pi_additional_files_pi" FOREIGN KEY ("pi_id")
          REFERENCES "proforma_invoices" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_pi_additional_files_uploaded_by" FOREIGN KEY ("uploaded_by")
          REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "pi_line_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "pi_id" uuid NOT NULL,
        "so_number" varchar,
        "material_num" varchar,
        "material_desc" varchar,
        "balance_to_be_delivered" numeric(14,2),
        "quantity" numeric(14,2),
        "mt" numeric(14,3),
        "load_factor" numeric(8,4),
        "loadability" numeric(8,4),
        "current_week_dispatch_load_factor" numeric(8,4),
        "current_week_dispatch_qty" numeric(14,2),
        CONSTRAINT "fk_pi_line_items_pi" FOREIGN KEY ("pi_id")
          REFERENCES "proforma_invoices" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "backorder_uploads" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "uploaded_at" timestamptz NOT NULL DEFAULT now(),
        "uploaded_by" uuid NOT NULL,
        "file_name" varchar NOT NULL,
        "rows_processed" integer NOT NULL DEFAULT 0,
        "new_cards_created" integer NOT NULL DEFAULT 0,
        CONSTRAINT "fk_backorder_uploads_uploaded_by" FOREIGN KEY ("uploaded_by")
          REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "stored_files" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "original_name" varchar NOT NULL,
        "mime_type" varchar NOT NULL,
        "size_bytes" bigint NOT NULL,
        "storage_key" varchar NOT NULL,
        "uploaded_by" varchar NOT NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "stored_files"`);
    await queryRunner.query(`DROP TABLE "backorder_uploads"`);
    await queryRunner.query(`DROP TABLE "pi_line_items"`);
    await queryRunner.query(`DROP TABLE "pi_additional_files"`);
    await queryRunner.query(`DROP TABLE "proforma_invoices"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "customers"`);

    await queryRunner.query(`DROP TYPE "pi_created_from_enum"`);
    await queryRunner.query(`DROP TYPE "user_role_enum"`);
    await queryRunner.query(`DROP TYPE "payment_terms_enum"`);
  }
}
