import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ApiError, apiClient } from "@/api/client"
import { downloadFile } from "@/lib/download"
import type { UserRef } from "@/api/types"

// Mirrors the backend entities (src/actual-containers/*.entity.ts). Calendar
// dates are "YYYY-MM-DD" strings; numeric columns arrive as strings.
export interface ActualContainerLineItem {
  id: string
  piNumber: string | null
  invoiceNumber: string | null
  pgiDate: string | null
  materialNum: string | null
  materialDesc: string | null
  quantity: string
  customerOrderRef: string | null
}

export interface ActualContainerFile {
  id: string
  fileUrl: string
  fileName: string
  uploadedBy: UserRef | null
  uploadedAt: string
  description: string | null
}

export interface ActualContainer {
  id: string
  containerNumber: string
  port: string | null
  vesselName: string | null
  // What the file said, and what CEAT typed over it (override wins).
  sourceEtd: string | null
  sourceEta: string | null
  overrideEtd: string | null
  overrideEta: string | null
  // Computed by the backend: override ?? source.
  etd: string | null
  eta: string | null
  isEtdOverridden: boolean
  isEtaOverridden: boolean
  preshipmentInvoice: string | null
  commercialInvoiceNumber: string | null
  // "ETA-15 days" extras: present only for containers in that week's sample.
  blNumber: string | null
  currency: string | null
  invoiceValue: string | null
  documentsReleaseStatus: string | null
  telexReleaseDate: string | null
  paymentReceiptStatus: string | null
  // Detail only.
  lineItems?: ActualContainerLineItem[]
  files?: ActualContainerFile[]
}

const LIST_KEY = ["actual-containers"] as const

// A 4xx is the server's answer ("not found", "no access"), not a glitch —
// retrying it only delays the message by the default backoff (~7 s).
function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false
  }
  return failureCount < 2
}

function detailKey(id: string | undefined) {
  return ["actual-containers", id] as const
}

export function useActualContainersQuery() {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: () => apiClient.get<ActualContainer[]>("/actual-containers"),
    staleTime: 30_000,
    retry: retryUnlessClientError,
  })
}

export function useActualContainerQuery(id: string | undefined) {
  return useQuery({
    queryKey: detailKey(id),
    queryFn: () => apiClient.get<ActualContainer>(`/actual-containers/${id}`),
    staleTime: 15_000,
    retry: retryUnlessClientError,
    enabled: !!id,
  })
}

// PATCH and reset answer with the whole container, so the detail cache is
// written straight from the response; the list only needs a refetch for its
// effective ETD/ETA columns (exact: the detail queries share the key prefix).
function useContainerCacheWriter(id: string) {
  const queryClient = useQueryClient()
  return (container: ActualContainer) => {
    queryClient.setQueryData(detailKey(id), container)
    queryClient.invalidateQueries({ queryKey: LIST_KEY, exact: true })
  }
}

// `null` clears that one override, a date sets it, an absent key leaves it.
export interface ContainerDatesInput {
  overrideEtd?: string | null
  overrideEta?: string | null
}

export function useUpdateContainerDatesMutation(id: string) {
  const writeCache = useContainerCacheWriter(id)
  return useMutation({
    mutationFn: (dates: ContainerDatesInput) =>
      apiClient.patch<ActualContainer>(`/actual-containers/${id}/dates`, dates),
    onSuccess: writeCache,
  })
}

export function useResetContainerDatesMutation(id: string) {
  const writeCache = useContainerCacheWriter(id)
  return useMutation({
    mutationFn: () =>
      apiClient.post<ActualContainer>(`/actual-containers/${id}/reset-dates`),
    onSuccess: writeCache,
  })
}

export function useAddContainerFileMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ file, description }: { file: File; description?: string }) => {
      const formData = new FormData()
      formData.append("file", file)
      if (description) {
        formData.append("description", description)
      }
      return apiClient.post<ActualContainerFile>(
        `/actual-containers/${id}/files`,
        formData
      )
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: detailKey(id) }),
  })
}

export function useDeleteContainerFileMutation(containerId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (fileId: string) =>
      apiClient.delete<void>(`/actual-container-files/${fileId}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: detailKey(containerId) }),
  })
}

export function downloadContainerFile(
  fileId: string,
  fileName: string
): Promise<void> {
  return downloadFile(`/actual-container-files/${fileId}/download`, fileName)
}
