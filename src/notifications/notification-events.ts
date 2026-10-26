/**
 * Phase 13: four triggers, four event names. Emitted explicitly at the end
 * of the relevant transactional service method (uploadPi, proposeReplacement,
 * unlock, ArrivalNotificationsService.checkArrivals) — not TypeORM
 * subscribers, which would fire on every save of the entity regardless of
 * which field changed or why; explicit emit keeps the trigger exact.
 */
export const NotificationEvent = {
  PI_READY_TO_SIGN: "pi.ready-to-sign",
  PI_REPLACEMENT_PROPOSED: "pi.replacement-proposed",
  CONTAINER_ARRIVAL_EXPECTED: "container.arrival-expected",
  // Phase 25: the load list going back and forth. To the client:
  LOAD_LIST_SENT: "load-list.sent",
  LOAD_LIST_APPROVED: "load-list.approved",
  LOAD_LIST_REJECTED: "load-list.rejected",
  // To CEAT (every ops user):
  LOAD_LIST_ACCEPTED: "load-list.accepted",
  LOAD_LIST_EDIT_REQUESTED: "load-list.edit-requested",
  LOAD_LIST_SUBMITTED: "load-list.submitted",
} as const;

/** Ops uploaded the original PI file — event 1 (uploadPi, both branches). */
export interface PiReadyToSignPayload {
  piNumber: string;
  label: string | null;
  customerId: string;
}

/** Ops proposed a replacement for the original PI file — event 2 (proposeReplacement). */
export interface PiReplacementProposedPayload {
  piNumber: string;
  label: string | null;
  customerId: string;
}

/**
 * Phase 25: every load-list notice names the customer (CEAT may have more
 * than one); a rejection carries CEAT's comment and what the rollback had to
 * cut to the current stock.
 */
export interface LoadListEventPayload {
  customerId: string;
  customerName: string;
  comment?: string;
  adjustments?: {
    containerLabel: string;
    piNumber: string;
    materialNum: string | null;
    wanted: number;
    placed: number;
  }[];
}

/** Event 4: ArrivalNotificationsService's daily cron, on first transition into "expected". */
export interface ContainerArrivalExpectedPayload {
  containerNumber: string;
  customerId: string;
  eta: string;
  daysUntilEta: number;
}
