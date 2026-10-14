// Pure (no React, no aliases): tested by npm test (node --test).

// Statuses nginx answers with on its own, when the backend didn't answer in
// time or at all — the request may well have been processed (or still be
// running) behind it.
const NO_ANSWER_STATUSES = new Set([502, 503, 504])

/**
 * Did a request fail without the server's own answer — a gateway timeout or a
 * dropped connection? Then its outcome is unknown: an upload may have gone
 * through, so it must not simply be offered again. A real answer (any other
 * status, e.g. a 400 about the file) is a definite failure.
 */
export function isOutcomeUnknown(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: unknown }).status
    return typeof status === "number" && NO_ANSWER_STATUSES.has(status)
  }
  // fetch() itself rejects (TypeError "Failed to fetch") when the connection
  // drops before any response arrives.
  return error instanceof TypeError
}
