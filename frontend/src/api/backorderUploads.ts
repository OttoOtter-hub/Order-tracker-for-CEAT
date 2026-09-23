import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/api/client"
import { downloadFile } from "@/lib/download"
import type { UserRef } from "@/api/types"

export interface BackorderUpload {
  id: string
  createdAt: string
  updatedAt: string
  uploadedAt: string
  uploadedBy: UserRef
  fileName: string
  rowsProcessed: number
  newCardsCreated: number
  cardsArchived: number
  rowsSkipped: number
}

// Response of POST /backorder-uploads specifically — adds cardsUpdated
// (computed server-side, not persisted) and omits uploadedBy (the actor
// already knows who they are). cardsArchived/cardsSkippedInvalidRows mirror
// the persisted cardsArchived/rowsSkipped columns, under the response's own
// naming.
export interface BackorderUploadResult {
  id: string
  uploadedAt: string
  fileName: string
  rowsProcessed: number
  newCardsCreated: number
  cardsUpdated: number
  cardsArchived: number
  cardsSkippedInvalidRows: number
}

export function useBackorderUploadsQuery() {
  return useQuery({
    queryKey: ["backorder-uploads"],
    queryFn: () => apiClient.get<BackorderUpload[]>("/backorder-uploads"),
    staleTime: 30_000,
  })
}

export function useUploadBackorderMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData()
      formData.append("file", file)
      return apiClient.post<BackorderUploadResult>(
        "/backorder-uploads",
        formData
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backorder-uploads"] })
      queryClient.invalidateQueries({ queryKey: ["proforma-invoices"] })
    },
  })
}

// GET /backorder/export-xlsx — deliberately a different base path than
// /backorder-uploads (that's the upload audit trail, ops-only; this is a
// live view over the current active backorder, available to both roles —
// the backend scopes the rows to the caller's own customer_id for client).
export function exportBackorderXlsx(): Promise<void> {
  return downloadFile("/backorder/export-xlsx", "Backorder_export.xlsx")
}

// GET /backorder-uploads/:id/snapshot-export (Phase 15) — reconstructs the
// exact .xlsx this upload was parsed from, sheet-for-sheet, from the raw
// BackorderUploadSnapshot rows. Ops-only, like the rest of this file's
// upload history.
export function exportSnapshot(id: string): Promise<void> {
  return downloadFile(
    `/backorder-uploads/${id}/snapshot-export`,
    "Backorder_snapshot.xlsx"
  )
}
