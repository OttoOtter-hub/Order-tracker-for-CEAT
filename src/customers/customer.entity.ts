import { Column, Entity, OneToMany } from "typeorm";
import { BaseEntity } from "../common/entities/base.entity";
import { PaymentTerms } from "../common/enums/payment-terms.enum";
import { ProformaInvoice } from "../proforma-invoices/proforma-invoice.entity";

@Entity("customers")
export class Customer extends BaseEntity {
  @Column({ type: "varchar" })
  name: string;

  @Column({ name: "customer_code", type: "varchar", unique: true })
  customerCode: string;

  @Column({ name: "tax_id", type: "varchar", nullable: true })
  taxId: string | null;

  @Column({ type: "text", nullable: true })
  address: string | null;

  @Column({ name: "default_port", type: "varchar", nullable: true })
  defaultPort: string | null;

  @Column({
    name: "default_payment_terms",
    type: "enum",
    enum: PaymentTerms,
    enumName: "payment_terms_enum",
    nullable: true,
  })
  defaultPaymentTerms: PaymentTerms | null;

  @OneToMany(() => ProformaInvoice, (pi) => pi.customer)
  proformaInvoices: ProformaInvoice[];
}
