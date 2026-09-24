import { MigrationInterface, QueryRunner } from "typeorm";

export class AddShippingContainerName1790800000000 implements MigrationInterface {
  name = "AddShippingContainerName1790800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Additive and nullable: no container has a name yet, and the previous
    // release (which doesn't know the column) keeps working.
    await queryRunner.query(
      `ALTER TABLE "shipping_containers" ADD COLUMN "name" varchar(30) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shipping_containers" DROP COLUMN "name"`,
    );
  }
}
