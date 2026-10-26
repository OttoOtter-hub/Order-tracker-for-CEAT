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
  // The line's proforma is archived: the position stays until removed.
  piArchived: boolean
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
  // Added by the client by hand ("Add container"), on top of the plan's
  // slots: works like any numbered container, never counted as a slot.
  isManual: boolean
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
  // Containers added by hand — apart from totalPossibleContainers.
  manualContainers: number
  canConfirm: boolean
  // Logged actions that "undo" can still roll back (containers not confirmed).
  // Non-zero even when every container looks empty, e.g. after removing all.
  undoableActions: number
  unallocatedLines: UnallocatedLine[]
  containers: ShippingContainer[]
  // Only on the "undo last" reply: removals passed over because their
  // proforma is archived (still in the log, not undone).
  undoSkipped?: UndoSkipped[]
  // Phase 25: where the load list stands and who may edit it now.
  loadList: LoadListView
}

export type LoadListStatus =
  | "draft_ceat"
  | "sent_to_client"
  | "client_editing"
  | "submitted_by_client"
  | "confirmed"

export interface LoadListAdjustment {
  containerLabel: string
  piNumber: string
  materialNum: string | null
  soNumber: string | null
  wanted: number
  placed: number
}

export interface LoadListView {
  status: LoadListStatus
  // The role that edits now: "ops" in draft_ceat, "client" in client_editing.
  editor: "ops" | "client" | null
  // The viewer is that role.
  canEdit: boolean
  sentAt: string | null
  editRequestedAt: string | null
  submittedAt: string | null
  confirmedAt: string | null
  rejectedAt: string | null
  rejectionComment: string | null
  rejectionAdjustments: LoadListAdjustment[]
  hasClientVersion: boolean
}

export interface LoadListDiff {
  ceatTakenAt: string
  clientTakenAt: string
  lines: {
    piNumber: string
    materialNum: string | null
    soNumber: string | null
    materialDesc: string | null
    changes: { container: string; ceatQty: number; clientQty: number }[]
  }[]
  containers: {
    label: string
    isOkToMix: boolean
    ceatQty: number
    clientQty: number
    ceatFillPercent: number | null
    clientFillPercent: number | null
  }[]
}

export interface UndoSkipped {
  code: "UNDO_SKIPPED_ARCHIVED_PI"
  piNumber: string
  materialNum: string | null
  // The container's number ("3"), or "OK to mix".
  container: string
  qty: number
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

// ops names the customer on every write too (the client is scoped by the
// token): "?customerId=" when there is one.
function withCustomer(path: string, customerId?: string): string {
  if (!customerId) return path
  return `${path}${path.includes("?") ? "&" : "?"}customerId=${encodeURIComponent(customerId)}`
}

// move / remove / undo-* / load-list steps all answer with the complete, fresh view —
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
      apiClient.post<ReadyToShipView>(withCustomer("/ready-to-ship/move", customerId), input)
  )
}

// Phase 21: every line's whole remainder into "OK to mix", all or nothing.
export function useMoveRemainingToMixMutation(customerId?: string) {
  return useViewMutation(customerId, () =>
    apiClient.post<ReadyToShipView>(
      withCustomer("/ready-to-ship/move-remaining-to-mix", customerId)
    )
  )
}

// One more numbered container, by hand, when the plan's slots ran out
// before the unallocated lines did. Phase 25: CEAT's, in draft_ceat.
export function useAddContainerMutation(customerId?: string) {
  return useViewMutation(customerId, () =>
    apiClient.post<ReadyToShipView>(
      withCustomer("/ready-to-ship/add-container", customerId)
    )
  )
}

// Phase 23: every position of one container back to the list at once
// (client-only; the container itself stays). One "undo last" puts it back.
export function useClearContainerMutation(customerId?: string) {
  return useViewMutation(customerId, (containerId: string) =>
    apiClient.post<ReadyToShipView>(
      withCustomer(`/containers/${containerId}/clear`, customerId)
    )
  )
}

// Same limit as the backend's UpdateContainerNameDto.
export const CONTAINER_NAME_MAX_LENGTH = 30

// Phase 22: client-only; null (or blank) clears the name.
export function useRenameContainerMutation(customerId?: string) {
  return useViewMutation(
    customerId,
    ({ containerId, name }: { containerId: string; name: string | null }) =>
      apiClient.patch<ReadyToShipView>(withCustomer(`/containers/${containerId}/name`, customerId), {
        name,
      })
  )
}

export function useRemoveMutation(customerId?: string) {
  return useViewMutation(
    customerId,
    (input: { allocationId: string; qty: number }) =>
      apiClient.post<ReadyToShipView>(withCustomer("/ready-to-ship/remove", customerId), input)
  )
}

export function useUndoLastMutation(customerId?: string) {
  return useViewMutation(customerId, () =>
    apiClient.post<ReadyToShipView>(withCustomer("/ready-to-ship/undo-last", customerId))
  )
}

export function useUndoAllMutation(customerId?: string) {
  return useViewMutation(customerId, () =>
    apiClient.post<ReadyToShipView>(withCustomer("/ready-to-ship/undo-all", customerId))
  )
}

// Phase 25: the load list's steps. Who may take which, from which status, is
// the server's call (and the page only offers what applies).
export type LoadListStep =
  | "send"
  | "accept"
  | "request-edit"
  | "submit"
  | "approve"
  | "reopen"

export function useLoadListStepMutation(customerId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (step: LoadListStep) =>
      apiClient.post<ReadyToShipView>(
        withCustomer(`/ready-to-ship/load-list/${step}`, customerId)
      ),
    onSuccess: (view) => {
      queryClient.setQueryData(readyToShipQueryKey(customerId), view)
      queryClient.removeQueries({ queryKey: [READY_TO_SHIP_KEY, "diff"] })
    },
  })
}

export function useRejectLoadListMutation(customerId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (comment: string) =>
      apiClient.post<ReadyToShipView>(
        withCustomer("/ready-to-ship/load-list/reject", customerId),
        { comment }
      ),
    onSuccess: (view) => {
      queryClient.setQueryData(readyToShipQueryKey(customerId), view)
      queryClient.removeQueries({ queryKey: [READY_TO_SHIP_KEY, "diff"] })
    },
  })
}

// CEAT's version against the client's (ops, while the client's version waits).
export function useLoadListDiffQuery(customerId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [READY_TO_SHIP_KEY, "diff", customerId ?? "me"],
    queryFn: () =>
      apiClient.get<LoadListDiff>(withCustomer("/ready-to-ship/load-list/diff", customerId)),
    enabled,
  })
}

export function downloadClientVersionXlsx(customerId?: string): Promise<void> {
  return downloadFile(
    withCustomer("/ready-to-ship/load-list/client-version.xlsx", customerId),
    "LoadList_client_version.xlsx"
  )
}

// Excel upload in the export's own format: ops in draft_ceat, the client in
// client_editing. confirmNewContainers: create the numbered containers the
// file names that don't exist yet (ops; asked for first).
export function useImportLoadListMutation(customerId?: string) {
  return useViewMutation(
    customerId,
    ({ file, confirmNewContainers }: { file: File; confirmNewContainers: boolean }) => {
      const formData = new FormData()
      formData.append("file", file)
      const path = withCustomer("/ready-to-ship/load-list/import-xlsx", customerId)
      return apiClient.post<ReadyToShipView>(
        confirmNewContainers ? `${path}${path.includes("?") ? "&" : "?"}confirmNewContainers=true` : path,
        formData
      )
    }
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

export interface UnlockedAll {
  customerId: string
  containersUnlocked: number
  positionsUnlocked: number
  containers: { id: string; label: string; positionsUnlocked: number }[]
}

// ops-only: every container of the customer that has a locked position, at
// once. Zeros (not an error) when nothing was locked.
export function useUnlockAllMutation(customerId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiClient.post<UnlockedAll>(
        `/ready-to-ship/unlock-all?customerId=${encodeURIComponent(customerId ?? "")}`
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

// Phase 24: every marking file of a container as one ZIP (both roles).
export function downloadMarkingZip(containerId: string): Promise<void> {
  return downloadFile(`/containers/${containerId}/marking-zip`, "marking.zip")
}

export function downloadMarkingFile(allocationId: string): Promise<void> {
  return downloadFile(
    `/container-allocations/${allocationId}/marking-file/download`,
    "marking.pdf"
  )
}
