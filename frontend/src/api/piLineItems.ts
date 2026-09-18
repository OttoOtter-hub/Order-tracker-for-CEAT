import { useMutation, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/api/client"
import type { PiLineItem } from "@/api/proformaInvoices"

// PATCH /pi-line-items/:id/priority — client-only (see root README:
// PiLineItemsService.updatePriority rejects ops explicitly, it isn't just a
// route guard). Invalidates the parent PI's detail query so
// priorityTotalQty/priorityTotalContainers (computed server-side) refresh —
// PiDetailPage's own draft state is what keeps the UI responsive in the
// meantime, this is just eventual consistency with the server.
export function useUpdatePriorityMutation(piId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      lineItemId,
      priorityQty,
    }: {
      lineItemId: string
      priorityQty: number
    }) =>
      apiClient.patch<PiLineItem>(`/pi-line-items/${lineItemId}/priority`, {
        priorityQty,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proforma-invoices", piId] })
    },
  })
}
