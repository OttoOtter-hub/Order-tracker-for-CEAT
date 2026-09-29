import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { apiClient } from "@/api/client"
import type { PiStatus } from "@/api/types"

// Mirrors GET /search (src/search/search.service.ts): one material across the
// three sections, each capped server-side (`truncated` = there were more).
export interface SearchSection<T> {
  items: T[]
  truncated: boolean
}

export interface PiSearchHit {
  piId: string
  piNumber: string
  piLabel: string | null
  status: PiStatus
  isShippedOnly: boolean
  customerId: string
  materialNum: string | null
  materialDesc: string | null
}

export interface ReadyToShipSearchHit {
  containerId: string
  containerLabel: string
  containerName: string | null
  isOkToMix: boolean
  isConfirmed: boolean
  customerId: string
  materialNum: string | null
  materialDesc: string | null
}

export interface ShippedSearchHit {
  actualContainerId: string
  containerNumber: string
  customerId: string
  materialNum: string | null
  materialDesc: string | null
}

export interface SearchResult {
  query: string
  pi: SearchSection<PiSearchHit>
  readyToShip: SearchSection<ReadyToShipSearchHit>
  shipped: SearchSection<ShippedSearchHit>
}

// `query` is expected already debounced and trimmed; empty asks nothing.
// The previous answer stays on screen while the next one loads.
export function useGlobalSearchQuery(query: string) {
  return useQuery({
    queryKey: ["search", query],
    queryFn: ({ signal }) =>
      apiClient.get<SearchResult>(`/search?q=${encodeURIComponent(query)}`, {
        signal,
      }),
    enabled: query.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: false,
  })
}
