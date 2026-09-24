import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/api/client"
import { downloadFile } from "@/lib/download"

// Mirrors the backend's ready-to-ship view (src/ready-to-ship/ready-to-ship.types.ts).
// Unlike the numeric-string columns on PiLineItem, every number here is a
// real JS number — the backend converts them while building the view.
export interface UnallocatedLine {
  piLineItemId: string
  piId: string
  piNumber: string
  piLabel: string | null
  soNumber: string | null
  materialNum: string | null
  materialDesc: string | null
  loadability: number | null
  currentWeekDispatchQty: number
  allocatedQty: number
  remainingQty: number
}

export interface MarkingFileRef {
  id: string
  uploadedAt: string
}

export interface ContainerAllocation {
  id: string
  piLineItemId: string
  piId: string
  piNumber: string
  piLabel: string | null
  soNumber: string | null
  materialNum: string | null
  materialDesc: string | null
  loadability: number | null
  allocatedQty: number
  // Phase 16: locked/unlocked lives per position now, not on the whole
  // container — a client-editable line inside an otherwise-confirmed
  // container is exactly one with isLocked: false.
  isLocked: boolean
  fillContribution: number
  markingFile: MarkingFileRef | null
}

export interface ShippingContainer {
  id: string
  label: string
  // Phase 22: the client's own name for a numbered container ("Ростов"),
  // shown as "Container 3: Ростов"; always null on "OK to mix".
  name: string | null
  // Phase 21: the customer's one "OK to mix" container — always last, no
  // fill percent (0) and never overfilled; totalQty/totalLines summarise it.
  isOkToMix: boolean
  totalQty: number
  totalLines: number
  // Derived (see backend ReadyToShipService.loadView): true only once every
  // position on this container is locked.
  isConfirmed: boolean
  // Derived: a mix — some positions locked, at least one not.
  isPartiallyUnlocked: boolean
  confirmedAt: string | null
  confirmedById: string | null
  fillPercent: number
  isOverfilled: boolean
  markingFilesUploaded: number
  markingFilesTotal: number
  allocations: ContainerAllocation[]
}

export interface ReadyToShipView {
  customerId: string
  totalPossibleContainers: number
  canConfirm: boolean
  // Logged actions that "undo" can still roll back (containers not confirmed).
  // Non-zero even when every container looks empty, e.g. after removing all.
  undoableActions: number
  unallocatedLines: UnallocatedLine[]
  containers: ShippingContainer[]
}

const READY_TO_SHIP_KEY = "ready-to-ship"

// ops must name the customer (client is scoped by the token) — the customer
// id is part of the key so switching customers never shows another one's data.
export function readyToShipQueryKey(customerId?: string) {
  return [READY_TO_SHIP_KEY, customerId ?? "me"] as const
}

export function useReadyToShipQuery(customerId?: string, enabled = true) {
  return useQuery({
    queryKey: readyToShipQueryKey(customerId),
    queryFn: () =>
      apiClient.get<ReadyToShipView>(
        customerId
          ? `/ready-to-ship?customerId=${encodeURIComponent(customerId)}`
          : "/ready-to-ship"
      ),
    staleTime: 15_000,
    enabled,
  })
}

// move / remove / undo-* / confirm all answer with the complete, fresh view —
// writing it straight into the cache shows the result immediately without a
// second round trip to reload 200+ rows; other queries never depend on it.
function useViewMutation<TVariables>(
  customerId: string | undefined,
  mutationFn: (variables: TVariables) => Promise<ReadyToShipView>
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (view) => {
      queryClient.setQueryData(readyToShipQueryKey(customerId), view)
    },
  })
}

export function useMoveMutation(customerId?: string) {
  return useViewMutation(
    customerId,
    (input: { piLineItemId: string; containerId: string; qty: number }) =>
      apiClient.post<ReadyToShipView>("/ready-to-ship/move", input)
  )
}

// Phase 21: every line's whole remainder into "OK to mix", all or nothing.
export function useMoveRemainingToMixMutation(customerId?: string) {
  return useViewMutation(customerId, () =>
    apiClient.post<ReadyToShipView>("/ready-to-ship/move-remaining-to-mix")
  )
}

// Same limit as the backend's UpdateContainerNameDto.
export const CONTAINER_NAME_MAX_LENGTH = 30

// Phase 22: client-only; null (or blank) clears the name.
export function useRenameContainerMutation(customerId?: string) {
  return useViewMutation(
    customerId,
    ({ containerId, name }: { containerId: string; name: string | null }) =>
      apiClient.patch<ReadyToShipView>(`/containers/${containerId}/name`, {
        name,
      })
  )
}

export function useRemoveMutation(customerId?: string) {
  return useViewMutation(
    customerId,
    (input: { allocationId: string; qty: number }) =>
      apiClient.post<ReadyToShipView>("/ready-to-ship/remove", input)
  )
}

export function useUndoLastMutation(customerId?: string) {
  return useViewMutation(customerId, () =>
    apiClient.post<ReadyToShipView>("/ready-to-ship/undo-last")
  )
}

export function useUndoAllMutation(customerId?: string) {
  return useViewMutation(customerId, () =>
    apiClient.post<ReadyToShipView>("/ready-to-ship/undo-all")
  )
}

export function useConfirmMutation(customerId?: string) {
  return useViewMutation(customerId, () =>
    apiClient.post<ReadyToShipView>("/ready-to-ship/confirm")
  )
}

// These three answer with a small acknowledgement, not the view, so the
// cache is refreshed from the server instead.
export function useUnlockContainerMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (containerId: string) =>
      apiClient.post<{ id: string; label: string }>(
        `/containers/${containerId}/unlock`
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [READY_TO_SHIP_KEY] }),
  })
}

// Phase 16: the finer-grained sibling — frees one position without touching
// the rest of its container.
export function useUnlockAllocationMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (allocationId: string) =>
      apiClient.post<{ id: string; containerLabel: string }>(
        `/container-allocations/${allocationId}/unlock`
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [READY_TO_SHIP_KEY] }),
  })
}

export function useUploadMarkingMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ allocationId, file }: { allocationId: string; file: File }) => {
      const formData = new FormData()
      formData.append("file", file)
      return apiClient.post<{ id: string }>(
        `/container-allocations/${allocationId}/marking-file`,
        formData
      )
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [READY_TO_SHIP_KEY] }),
  })
}

export function useDeleteMarkingMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (allocationId: string) =>
      apiClient.delete<void>(
        `/container-allocations/${allocationId}/marking-file`
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [READY_TO_SHIP_KEY] }),
  })
}

// One flat sheet: placed lines under their container number, the rest as
// "OK to mix". ops names the customer (same as the view); the file name comes
// from the server's Content-Disposition.
export function exportReadyToShipXlsx(customerId?: string): Promise<void> {
  return downloadFile(
    customerId
      ? `/ready-to-ship/export-xlsx?customerId=${encodeURIComponent(customerId)}`
      : "/ready-to-ship/export-xlsx",
    "ReadyToShip.xlsx"
  )
}

export function downloadMarkingFile(allocationId: string): Promise<void> {
  return downloadFile(
    `/container-allocations/${allocationId}/marking-file/download`,
    "marking.pdf"
  )
}
