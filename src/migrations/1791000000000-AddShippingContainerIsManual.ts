import { MigrationInterface, QueryRunner } from "typeorm";

export class AddShippingContainerIsManual1791000000000 implements MigrationInterface {
  name = "AddShippingContainerIsManual1791000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Additive, with a default: every existing container is a slot of the
    // plan (false), and the previous release (which doesn't know the column)
    // keeps creating such slots.
    await queryRunner.query(
      `ALTER TABLE "shipping_containers" ADD COLUMN "is_manual" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shipping_containers" DROP COLUMN "is_manual"`,
    );
  }
}
