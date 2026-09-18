export type PiStatus =
  | "missing_pi_document"
  | "missing_signed_document"
  | "signed"
  | "replacement_pending"
  | "archived_shipped"

export type PiCreatedFrom = "pi_upload" | "backorder_row"

export type PaymentTerms = "prepayment_100" | "advance_30" | "copy_docs_100"

export interface Customer {
  id: string
  createdAt: string
  updatedAt: string
  name: string
  customerCode: string
  taxId: string | null
  address: string | null
  defaultPort: string | null
  defaultPaymentTerms: PaymentTerms | null
}

export interface UserRef {
  id: string
  email: string
}
