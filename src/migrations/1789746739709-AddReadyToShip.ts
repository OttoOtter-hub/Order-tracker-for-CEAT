import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReadyToShip1789746739709 implements MigrationInterface {
  name = "AddReadyToShip1789746739709";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "shipping_containers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "customer_id" uuid NOT NULL,
        "label" varchar NOT NULL,
        "is_confirmed" boolean NOT NULL DEFAULT false,
        "confirmed_at" timestamptz,
        "confirmed_by" uuid,
        CONSTRAINT "uq_shipping_containers_customer_label" UNIQUE ("customer_id", "label"),
        CONSTRAINT "fk_shipping_containers_customer" FOREIGN KEY ("customer_id")
          REFERENCES "customers" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_shipping_containers_confirmed_by" FOREIGN KEY ("confirmed_by")
          REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "container_line_allocations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "container_id" uuid NOT NULL,
        "pi_line_item_id" uuid NOT NULL,
        "allocated_qty" numeric(14,2) NOT NULL,
        CONSTRAINT "uq_container_line_allocations_container_line" UNIQUE ("container_id", "pi_line_item_id"),
        CONSTRAINT "chk_container_line_allocations_qty_positive" CHECK ("allocated_qty" > 0),
        CONSTRAINT "fk_container_line_allocations_container" FOREIGN KEY ("container_id")
          REFERENCES "shipping_containers" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_container_line_allocations_line_item" FOREIGN KEY ("pi_line_item_id")
          REFERENCES "pi_line_items" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "allocation_actions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "customer_id" uuid NOT NULL,
        "container_id" uuid NOT NULL,
        "pi_line_item_id" uuid NOT NULL,
        "delta_qty" numeric(14,2) NOT NULL,
        CONSTRAINT "fk_allocation_actions_customer" FOREIGN KEY ("customer_id")
          REFERENCES "customers" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_allocation_actions_container" FOREIGN KEY ("container_id")
          REFERENCES "shipping_containers" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_allocation_actions_line_item" FOREIGN KEY ("pi_line_item_id")
          REFERENCES "pi_line_items" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "marking_files" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "container_line_allocation_id" uuid NOT NULL,
        "file_url" text NOT NULL,
        "uploaded_by" uuid NOT NULL,
        "uploaded_at" timestamptz NOT NULL,
        CONSTRAINT "uq_marking_files_allocation" UNIQUE ("container_line_allocation_id"),
        CONSTRAINT "fk_marking_files_allocation" FOREIGN KEY ("container_line_allocation_id")
          REFERENCES "container_line_allocations" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_marking_files_uploaded_by" FOREIGN KEY ("uploaded_by")
          REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "marking_files"`);
    await queryRunner.query(`DROP TABLE "allocation_actions"`);
    await queryRunner.query(`DROP TABLE "container_line_allocations"`);
    await queryRunner.query(`DROP TABLE "shipping_containers"`);
  }
}
