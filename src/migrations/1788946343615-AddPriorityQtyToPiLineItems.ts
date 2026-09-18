import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPriorityQtyToPiLineItems1788946343615
  implements MigrationInterface
{
  name = "AddPriorityQtyToPiLineItems1788946343615";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pi_line_items" ADD "priority_qty" numeric(14,2) NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pi_line_items" DROP COLUMN "priority_qty"`,
    );
  }
}
