import { MigrationInterface, QueryRunner } from "typeorm";

export class AddContainerLineAllocationIsLocked1790300000000 implements MigrationInterface {
  name = "AddContainerLineAllocationIsLocked1790300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Additive and defaulted: the previous release ignores this column.
    // Phase 16 moves "locked/unlocked" from the whole container
    // (shipping_containers.is_confirmed) down to each of its positions —
    // backfill every existing row from the container it currently sits in,
    // so the new per-position model starts out identical to what the old
    // whole-container boolean already meant. shipping_containers.is_confirmed
    // itself is deliberately left in place (unused by the new code, but
    // dropping it here would break the old dist still running until this
    // deploy's code swap completes — a later cleanup migration can drop it).
    await queryRunner.query(
      `ALTER TABLE "container_line_allocations" ADD COLUMN "is_locked" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`
      UPDATE "container_line_allocations" cla
      SET "is_locked" = true
      FROM "shipping_containers" sc
      WHERE cla."container_id" = sc."id" AND sc."is_confirmed" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "container_line_allocations" DROP COLUMN "is_locked"`,
    );
  }
}
