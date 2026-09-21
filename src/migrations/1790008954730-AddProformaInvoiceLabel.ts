import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProformaInvoiceLabel1790008954730 implements MigrationInterface {
  name = "AddProformaInvoiceLabel1790008954730";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Additive and nullable: the previous release ignores the column.
    await queryRunner.query(
      `ALTER TABLE "proforma_invoices" ADD COLUMN "label" varchar(30)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "proforma_invoices" DROP COLUMN "label"`,
    );
  }
}
