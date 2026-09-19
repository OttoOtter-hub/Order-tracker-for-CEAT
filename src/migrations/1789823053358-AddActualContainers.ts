import { MigrationInterface, QueryRunner } from "typeorm";

export class AddActualContainers1789823053358 implements MigrationInterface {
  name = "AddActualContainers1789823053358";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Additive only: new tables plus one defaulted column, so the previous
    // release keeps working against this schema.
    await queryRunner.query(`
      CREATE TABLE "backorder_upload_snapshots" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "backorder_upload_id" uuid NOT NULL,
        "sheet_name" varchar NOT NULL,
        "sheet_index" integer NOT NULL,
        "row_index" integer NOT NULL,
        "raw_row_data" jsonb NOT NULL,
        CONSTRAINT "fk_backorder_upload_snapshots_upload" FOREIGN KEY ("backorder_upload_id")
          REFERENCES "backorder_uploads" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_backorder_upload_snapshots_upload"
        ON "backorder_upload_snapshots" ("backorder_upload_id", "sheet_index", "row_index")
    `);

    await queryRunner.query(`
      CREATE TABLE "actual_containers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "container_number" varchar NOT NULL,
        "customer_id" uuid NOT NULL,
        "port" varchar,
        "vessel_name" varchar,
        "source_etd" date,
        "source_eta" date,
        "preshipment_invoice" varchar,
        "commercial_invoice_number" varchar,
        "override_etd" date,
        "override_eta" date,
        "bl_number" varchar,
        "currency" varchar,
        "invoice_value" numeric(16,2),
        "documents_release_status" varchar,
        "telex_release_date" date,
        "payment_receipt_status" varchar,
        "last_seen_in_upload_id" uuid,
        CONSTRAINT "uq_actual_containers_container_number" UNIQUE ("container_number"),
        CONSTRAINT "fk_actual_containers_customer" FOREIGN KEY ("customer_id")
          REFERENCES "customers" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_actual_containers_last_seen_upload" FOREIGN KEY ("last_seen_in_upload_id")
          REFERENCES "backorder_uploads" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_actual_containers_customer" ON "actual_containers" ("customer_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "actual_container_line_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "actual_container_id" uuid NOT NULL,
        "pi_number" varchar,
        "invoice_number" varchar,
        "pgi_date" date,
        "material_num" varchar,
        "material_desc" varchar,
        "quantity" numeric(14,2) NOT NULL,
        "customer_order_ref" varchar,
        CONSTRAINT "fk_actual_container_line_items_container" FOREIGN KEY ("actual_container_id")
          REFERENCES "actual_containers" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_actual_container_line_items_container" ON "actual_container_line_items" ("actual_container_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_actual_container_line_items_pi_number" ON "actual_container_line_items" ("pi_number")`,
    );

    await queryRunner.query(`
      CREATE TABLE "actual_container_files" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "actual_container_id" uuid NOT NULL,
        "file_url" text NOT NULL,
        "file_name" varchar NOT NULL,
        "uploaded_by" uuid NOT NULL,
        "uploaded_at" timestamptz NOT NULL,
        "description" text,
        CONSTRAINT "fk_actual_container_files_container" FOREIGN KEY ("actual_container_id")
          REFERENCES "actual_containers" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_actual_container_files_uploaded_by" FOREIGN KEY ("uploaded_by")
          REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_actual_container_files_container" ON "actual_container_files" ("actual_container_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "proforma_invoices" ADD COLUMN "shipped_qty" numeric(14,2) NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "proforma_invoices" DROP COLUMN "shipped_qty"`,
    );
    await queryRunner.query(`DROP TABLE "actual_container_files"`);
    await queryRunner.query(`DROP TABLE "actual_container_line_items"`);
    await queryRunner.query(`DROP TABLE "actual_containers"`);
    await queryRunner.query(`DROP TABLE "backorder_upload_snapshots"`);
  }
}
