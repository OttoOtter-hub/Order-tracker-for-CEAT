import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserIsActive1790500000000 implements MigrationInterface {
  name = "AddUserIsActive1790500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Additive, defaulted to true: every existing user stays active, and the
    // previous release (which doesn't know the column) keeps working.
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "is_active" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "is_active"`);
  }
}
