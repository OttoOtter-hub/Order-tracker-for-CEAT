import { MigrationInterface, QueryRunner } from "typeorm";

export class AddShippingContainerOkToMix1790700000000 implements MigrationInterface {
  name = "AddShippingContainerOkToMix1790700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Additive and defaulted: every existing slot stays a numbered one, and
    // the previous release (which doesn't know the column) keeps working.
    await queryRunner.query(
      `ALTER TABLE "shipping_containers" ADD COLUMN "is_ok_to_mix" boolean NOT NULL DEFAULT false`,
    );
    // At most one "OK to mix" per customer, whatever its label.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_shipping_containers_ok_to_mix" ON "shipping_containers" ("customer_id") WHERE "is_ok_to_mix"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_shipping_containers_ok_to_mix"`);
    await queryRunner.query(
      `ALTER TABLE "shipping_containers" DROP COLUMN "is_ok_to_mix"`,
    );
  }
}
