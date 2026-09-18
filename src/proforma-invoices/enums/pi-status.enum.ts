/**
 * Computed lifecycle status of a PI card — never written directly, see
 * ProformaInvoice.status. Not a DB enum type since there is no column.
 */
export enum PiStatus {
  MISSING_PI_DOCUMENT = "missing_pi_document",
  MISSING_SIGNED_DOCUMENT = "missing_signed_document",
  SIGNED = "signed",
  REPLACEMENT_PENDING = "replacement_pending",
  ARCHIVED_SHIPPED = "archived_shipped",
}
