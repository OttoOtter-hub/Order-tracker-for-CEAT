import type { AuditEntry } from "../../audit-log/audit-log.service";

/**
 * Stand-in for AuditLogService in service specs: keeps every recorded entry
 * (and whether it was written inside the caller's transaction) so a spec can
 * assert what an action journaled.
 */
export function makeFakeAudit() {
  const entries: (AuditEntry & { inTransaction: boolean })[] = [];
  return {
    entries,
    record: jest.fn(async (entry: AuditEntry, em?: unknown) => {
      entries.push({ ...entry, inTransaction: em !== undefined });
    }),
    /** The actions recorded so far, in order. */
    actions: () => entries.map((e) => e.action),
  };
}

export type FakeAudit = ReturnType<typeof makeFakeAudit>;
