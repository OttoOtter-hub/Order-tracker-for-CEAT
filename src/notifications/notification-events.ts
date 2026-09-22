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
  CONTAINER_REOPENED_FOR_CLIENT: "container.reopened-for-client",
  CONTAINER_ARRIVAL_EXPECTED: "container.arrival-expected",
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
 * Event 3: no "proposed_to_client" status exists on ShippingContainer (it's
 * just a boolean is_confirmed, entirely client-driven — client allocates and
 * confirms on their own, with no ops "proposal" step in the happy path). The
 * one point where ops action puts a container back in front of the client
 * for review is unlock(): it reverts a previously-confirmed container to
 * draft, so the client needs to look at it again and re-confirm. See the
 * README ("Фаза 13") for the full reasoning.
 */
export interface ContainerReopenedForClientPayload {
  label: string;
  customerId: string;
}

/** Event 4: ArrivalNotificationsService's daily cron, on first transition into "expected". */
export interface ContainerArrivalExpectedPayload {
  containerNumber: string;
  customerId: string;
  eta: string;
  daysUntilEta: number;
}
