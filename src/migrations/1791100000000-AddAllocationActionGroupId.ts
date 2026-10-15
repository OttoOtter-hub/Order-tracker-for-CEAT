import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAllocationActionGroupId1791100000000 implements MigrationInterface {
  name = "AddAllocationActionGroupId1791100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Additive and nullable: every existing undo entry stays a step of its
    // own, and the previous release (which doesn't know the column) keeps
    // writing such entries.
    await queryRunner.query(
      `ALTER TABLE "allocation_actions" ADD COLUMN "group_id" uuid NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "allocation_actions" DROP COLUMN "group_id"`,
    );
  }
}
