import { MigrationInterface, QueryRunner } from "typeorm";

export class AddActualContainerArrivalNotification1790200000000 implements MigrationInterface {
  name = "AddActualContainerArrivalNotification1790200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Additive and nullable: the previous release ignores this column. Set
    // once, the first time a container's computed arrivalStatus is seen as
    // "expected" by the daily cron (ArrivalNotificationsService) — never
    // reset, so it also doubles as "has this container ever been notified".
    await queryRunner.query(
      `ALTER TABLE "actual_containers" ADD COLUMN "arrival_notification_sent_at" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "actual_containers" DROP COLUMN "arrival_notification_sent_at"`,
    );
  }
}
