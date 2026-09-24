import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { apiClient } from "@/api/client"
import type { UserRef } from "@/api/types"

// Mirrors the backend registry (src/audit-log/audit-actions.ts).
export const AUDIT_ENTITY_TYPES = [
  "pi",
  "backorder_upload",
  "shipping_container",
  "customer",
  "actual_container",
  "user",
] as const

export interface AuditLogEntry {
  id: string
  createdAt: string
  actor: UserRef | null
  action: string
  entityType: string
  entityId: string | null
  metadata: Record<string, unknown>
}

export interface AuditLogPage {
  items: AuditLogEntry[]
  total: number
  page: number
  pageSize: number
}

export interface AuditLogFilters {
  actorUserId?: string
  entityType?: string
  /** Inclusive, ISO timestamp. */
  from?: string
  /** Exclusive, ISO timestamp. */
  to?: string
}

export const AUDIT_PAGE_SIZE = 50

// GET /audit-log — ops only, one page at a time (newest first). The previous
// page stays on screen while the next one loads, so paging doesn't flash.
export function useAuditLogQuery(filters: AuditLogFilters, page: number) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(AUDIT_PAGE_SIZE),
  })
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      params.set(key, value)
    }
  }
  return useQuery({
    queryKey: ["audit-log", filters, page],
    queryFn: () => apiClient.get<AuditLogPage>(`/audit-log?${params}`),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
}
