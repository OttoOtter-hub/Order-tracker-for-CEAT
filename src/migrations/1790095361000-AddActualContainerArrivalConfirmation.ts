import { MigrationInterface, QueryRunner } from "typeorm";

export class AddActualContainerArrivalConfirmation1790095361000 implements MigrationInterface {
  name = "AddActualContainerArrivalConfirmation1790095361000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Additive and nullable: the previous release ignores both columns.
    await queryRunner.query(
      `ALTER TABLE "actual_containers" ADD COLUMN "arrival_confirmed_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "actual_containers" ADD COLUMN "arrival_confirmed_by" uuid`,
    );
    await queryRunner.query(`
      ALTER TABLE "actual_containers"
        ADD CONSTRAINT "fk_actual_containers_arrival_confirmed_by" FOREIGN KEY ("arrival_confirmed_by")
        REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "actual_containers" DROP CONSTRAINT "fk_actual_containers_arrival_confirmed_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "actual_containers" DROP COLUMN "arrival_confirmed_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "actual_containers" DROP COLUMN "arrival_confirmed_at"`,
    );
  }
}
