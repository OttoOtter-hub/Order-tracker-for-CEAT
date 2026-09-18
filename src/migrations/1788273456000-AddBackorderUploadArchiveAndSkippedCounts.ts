import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBackorderUploadArchiveAndSkippedCounts1788273456000
  implements MigrationInterface
{
  name = "AddBackorderUploadArchiveAndSkippedCounts1788273456000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "backorder_uploads" ADD "cards_archived" int NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "backorder_uploads" ADD "rows_skipped" int NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "backorder_uploads" DROP COLUMN "rows_skipped"`,
    );
    await queryRunner.query(
      `ALTER TABLE "backorder_uploads" DROP COLUMN "cards_archived"`,
    );
  }
}
