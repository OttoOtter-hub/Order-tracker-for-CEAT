import { API_BASE_URL } from "@/api/client"

// fileUrl/docUrl/signedDocUrl fields hold either a fully external URL
// (pasted by hand) or a relative /files/:id/download path returned by
// POST /files/upload — only the latter needs the API origin prefixed
// before window.open() can actually fetch it from the frontend's origin.
export function resolveFileUrl(url: string): string {
  return url.startsWith("/") ? `${API_BASE_URL}${url}` : url
}
