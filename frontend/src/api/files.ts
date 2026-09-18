import { useMutation } from "@tanstack/react-query"
import { apiClient } from "@/api/client"

export interface UploadFileResponse {
  id: string
  url: string
  originalName: string
  mimeType: string
}

// Backing store for the fileUrl/docUrl/signedDocUrl text fields elsewhere
// in the API (containers documents, telex release, PI signed doc) — upload
// the bytes here first, then pass the returned relative url into those.
export function useUploadFileMutation() {
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData()
      formData.append("file", file)
      return apiClient.post<UploadFileResponse>("/files/upload", formData)
    },
  })
}
