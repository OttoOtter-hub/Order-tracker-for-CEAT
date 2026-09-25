import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * A third access level: an ops user can also be an admin (user management
 * and the action log). Additive — the previous release ignores the column.
 *
 * So that nobody loses admin access on deploy, exactly one existing user is
 * made an admin: the earliest-created *active* ops user (or, if no ops user
 * is active, the earliest ops user at all). Every other user stays false.
 */
export class AddUserIsAdmin1790900000000 implements MigrationInterface {
  name = "AddUserIsAdmin1790900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "is_admin" boolean NOT NULL DEFAULT false`,
    );
    // Only an ops user can be an admin (for a client the flag means nothing).
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "chk_users_admin_is_ops" CHECK (NOT "is_admin" OR "role" = 'ops')`,
    );
    await queryRunner.query(
      `UPDATE "users" SET "is_admin" = true WHERE "id" = (
         SELECT "id" FROM "users" WHERE "role" = 'ops'
         ORDER BY "is_active" DESC, "created_at" ASC, "id" ASC
         LIMIT 1
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "chk_users_admin_is_ops"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "is_admin"`);
  }
}
