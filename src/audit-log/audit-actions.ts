/**
 * Every action the journal can hold (Phase 20b). The frontend shows each
 * through audit.actions.<action> in its en/ru dictionaries — a parity test
 * keeps the two in step, like the error codes (see api-error.ts).
 */
export const AUDIT_ACTIONS = [
  // Proforma invoices
  "pi.file_uploaded",
  "pi.replacement_proposed",
  "pi.replacement_approved",
  "pi.replacement_rejected",
  "pi.signed",
  "pi.signed_file_replaced",
  "pi.additional_file_added",
  "pi.label_changed",
  "pi.priority_changed",
  "pi.priority_reset",

  // Backorder
  "backorder.uploaded",

  // Ready to ship
  "rts.moved",
  "rts.moved_remaining_to_mix",
  "rts.removed",
  "rts.container_renamed",
  "rts.undone_last",
  "rts.undone_all",
  "rts.confirmed",
  "rts.container_unlocked",
  "rts.unlocked_all",
  "rts.position_unlocked",
  "rts.marking_uploaded",
  "rts.marking_deleted",

  // Shipped containers
  "container.arrival_confirmed",
  "container.arrival_revoked",
  "container.dates_changed",
  "container.dates_reset",
  "container.file_uploaded",
  "container.file_deleted",

  // Users
  "user.created",
  "user.deactivated",
  "user.reactivated",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** What an entry is about; `entityId` is that thing's id. */
export const AUDIT_ENTITY_TYPES = [
  "pi",
  "backorder_upload",
  "shipping_container",
  "container_allocation",
  "customer",
  "actual_container",
  "user",
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];
