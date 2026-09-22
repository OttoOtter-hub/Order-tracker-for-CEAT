import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/api/client"
import { downloadFile } from "@/lib/download"
import type { Customer, PiCreatedFrom, PiStatus, UserRef } from "@/api/types"

export interface PiLineItem {
  id: string
  createdAt: string
  updatedAt: string
  soNumber: string | null
  materialNum: string | null
  materialDesc: string | null
  balanceToBeDelivered: string | null
  quantity: string | null
  mt: string | null
  loadFactor: string | null
  loadability: string | null
  currentWeekDispatchLoadFactor: string | null
  currentWeekDispatchQty: string | null
  // Client's shipment-planning priority for this row (0..balanceToBeDelivered).
  // Never null — defaults to "0" — unlike the columns above, which come
  // from the backorder file and can be genuinely absent.
  priorityQty: string
}

// Plan-vs-actual per material within this one PI card (Phase 12), quantities
// only. Backend (ProformaInvoicesService.buildReconciliation) already groups
// across SO rows sharing a material and does the confirmed-only filtering —
// the frontend just renders these numbers, real JS numbers unlike the
// numeric-string PiLineItem columns.
export interface ReconciliationRow {
  materialNum: string
  materialDesc: string | null
  plannedQty: number
  shippedQty: number
  delta: number
}

export interface PiAdditionalFile {
  id: string
  createdAt: string
  updatedAt: string
  fileUrl: string
  uploadedBy: UserRef
  uploadedAt: string
  description: string | null
}

export interface ProformaInvoice {
  id: string
  createdAt: string
  updatedAt: string
  piNumber: string
  // Set only by the client, at most 30 characters, and only until the signed
  // file is uploaded — after that the backend refuses any change (400).
  label: string | null
  customer: Customer
  status: PiStatus
  piFileUrl: string | null
  piFileUploadedAt: string | null
  piFileUploadedBy: UserRef | null
  signedFileUrl: string | null
  signedFileUploadedAt: string | null
  signedFileUploadedBy: UserRef | null
  pendingReplacementFileUrl: string | null
  pendingReplacementProposedBy: UserRef | null
  pendingReplacementProposedAt: string | null
  isArchivedShipped: boolean
  createdFrom: PiCreatedFrom
  totalQty: string | null
  totalContainers: string | null
  qtyPending: string | null
  containersPending: string | null
  currentWeekPlanContainers: string | null
  currentWeekPlanQty: string | null
  // Σ quantity of every shipped container line with this PI number — the
  // backend recomputes it from scratch on each backorder upload (numeric
  // string like the columns above; "0.00" when nothing has shipped).
  shippedQty: string
  // Computed on every read from lineItems' priorityQty (backend getters,
  // not stored columns — see ProformaInvoice.priorityTotalQty in the root
  // README) — real JS numbers, unlike the numeric-string columns above.
  priorityTotalQty: number
  priorityTotalContainers: number
  // How many line items carry a priority (priorityQty > 0) — same live getter
  // family as the two above.
  priorityLineItemsCount: number
  // Detail only (GET /proforma-invoices/:id and every write response on this
  // card) — the list endpoint doesn't compute it, to avoid two extra queries
  // per card on every GET /proforma-invoices.
  reconciliation?: ReconciliationRow[]
  lineItems?: PiLineItem[]
  additionalFiles?: PiAdditionalFile[]
}

export function usePiListQuery() {
  return useQuery({
    queryKey: ["proforma-invoices"],
    queryFn: () => apiClient.get<ProformaInvoice[]>("/proforma-invoices"),
    staleTime: 30_000,
  })
}

export function usePiDetailQuery(id: string | undefined) {
  return useQuery({
    queryKey: ["proforma-invoices", id],
    queryFn: () => apiClient.get<ProformaInvoice>(`/proforma-invoices/${id}`),
    staleTime: 30_000,
    enabled: !!id,
  })
}

// PI number is read from the filename server-side (see backend
// extractPiNumber) — no other form field needed. Creates a new card, or
// fills in pi_file_url on an existing backorder_row card, or 409s if the
// number is already filed.
export function useUploadPiMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData()
      formData.append("file", file)
      return apiClient.post<ProformaInvoice>(
        "/proforma-invoices/upload-pi",
        formData
      )
    },
    onSuccess: (pi) => {
      queryClient.invalidateQueries({ queryKey: ["proforma-invoices"] })
      queryClient.setQueryData(["proforma-invoices", pi.id], pi)
    },
  })
}

export function useUploadSignedMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData()
      formData.append("file", file)
      return apiClient.post<ProformaInvoice>(
        `/proforma-invoices/${id}/upload-signed`,
        formData
      )
    },
    onSuccess: (pi) => {
      queryClient.invalidateQueries({ queryKey: ["proforma-invoices"] })
      queryClient.setQueryData(["proforma-invoices", id], pi)
    },
  })
}

export function useAddAdditionalFileMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      file,
      description,
    }: {
      file: File
      description?: string
    }) => {
      const formData = new FormData()
      formData.append("file", file)
      if (description) {
        formData.append("description", description)
      }
      return apiClient.post<PiAdditionalFile>(
        `/proforma-invoices/${id}/additional-files`,
        formData
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proforma-invoices", id] })
    },
  })
}

export function useProposeReplacementMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData()
      formData.append("file", file)
      return apiClient.post<ProformaInvoice>(
        `/proforma-invoices/${id}/propose-replacement`,
        formData
      )
    },
    onSuccess: (pi) => {
      queryClient.invalidateQueries({ queryKey: ["proforma-invoices"] })
      queryClient.setQueryData(["proforma-invoices", id], pi)
    },
  })
}

export function exportPiXlsx(id: string): Promise<void> {
  return downloadFile(
    `/proforma-invoices/${id}/export-xlsx`,
    "PI_export.xlsx"
  )
}

export function useReplacementDecisionMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (approved: boolean) =>
      apiClient.post<ProformaInvoice>(
        `/proforma-invoices/${id}/replacement-decision`,
        { approved }
      ),
    onSuccess: (pi) => {
      queryClient.invalidateQueries({ queryKey: ["proforma-invoices"] })
      queryClient.setQueryData(["proforma-invoices", id], pi)
    },
  })
}

export const PI_LABEL_MAX_LENGTH = 30

// PATCH /proforma-invoices/:id/label — client-only, and only while the PI is
// unsigned (400 afterwards). An empty string or null clears the label.
export function useUpdateLabelMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (label: string | null) =>
      apiClient.patch<ProformaInvoice>(`/proforma-invoices/${id}/label`, {
        label,
      }),
    onSuccess: (pi) => {
      queryClient.invalidateQueries({ queryKey: ["proforma-invoices"] })
      queryClient.setQueryData(["proforma-invoices", id], pi)
    },
    // A refusal means the PI was signed meanwhile — refetch so the field locks.
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["proforma-invoices"] })
    },
  })
}

// PATCH /proforma-invoices/:id/reset-priority — client-only, zeroes every
// line item's priorityQty in one backend call (not N PATCH .../priority
// calls from here). setQueryData with the response means the "Всего"/
// "Приоритет" table below sees zeroed lineItems immediately, same as every
// other mutation here — the caller (PiDetailPage) additionally clears its
// own priorityDrafts state, since that draft state doesn't otherwise track
// query-cache updates (see PiDetailPage's pi?.id-only reset effect).
export function useResetPriorityMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiClient.patch<ProformaInvoice>(
        `/proforma-invoices/${id}/reset-priority`
      ),
    onSuccess: (pi) => {
      queryClient.invalidateQueries({ queryKey: ["proforma-invoices"] })
      queryClient.setQueryData(["proforma-invoices", id], pi)
    },
  })
}
