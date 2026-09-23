import { ApiError, apiErrorFromBody } from "@/api/client"
import i18n from "@/i18n"
import { resolveFileUrl } from "@/lib/fileUrl"
import { getStoredToken } from "@/auth/storage"

// A failed download carries the server's own explanation (code + message) in
// its JSON body; parse it the same way as any other API error, so
// getErrorMessage can translate it.
async function downloadError(response: Response): Promise<ApiError> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    // not JSON — the generic text below
  }
  return apiErrorFromBody(body, response.status, i18n.t("common.downloadFailed"))
}

// GET /files/:id/download requires Authorization: Bearer <token> — a plain
// window.open(url) navigation never sends that header, so it would 401.
// Fetch with the token attached instead, then open the bytes as a blob: URL
// (works for both "view inline" for PDFs and "save" for everything else).
//
// window.open() must happen synchronously inside the click handler — call
// it *before* the `fetch`/`await`, not after. Popup blockers only allow
// window.open() called directly within a user-gesture's call stack; once
// this function has awaited anything, a later window.open() is just as
// blocked as one from a setTimeout. Opening a blank tab first and later
// pointing it at the object URL keeps the open() call itself synchronous.
export async function openFile(url: string): Promise<void> {
  const target = window.open("", "_blank")
  try {
    const token = getStoredToken()
    const response = await fetch(resolveFileUrl(url), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!response.ok) {
      throw await downloadError(response)
    }
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    if (target) {
      target.location.href = objectUrl
    } else {
      // Even the synchronous open() was blocked — fall back to navigating
      // the current tab rather than silently doing nothing.
      window.location.href = objectUrl
    }
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  } catch (error) {
    target?.close()
    throw error
  }
}

// For a real "save this file" action (xlsx exports) rather than "view it" —
// an <a download> click, not window.open, so there's no popup-blocker
// concern here (a same-document anchor click isn't a new-window request).
// Filename comes from the server's Content-Disposition when present (see
// main.ts's exposedHeaders — needed cross-origin, e.g. local dev's
// 5173 -> 3000) so it matches exactly what the backend named the file,
// falling back to a generic name only if that header is somehow missing.
export async function downloadFile(
  url: string,
  fallbackFilename = "export.xlsx"
): Promise<void> {
  const token = getStoredToken()
  const response = await fetch(resolveFileUrl(url), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) {
    throw await downloadError(response)
  }
  const disposition = response.headers.get("content-disposition")
  const match = disposition?.match(/filename="?([^";]+)"?/)
  // The backend percent-encodes the name ("packing%20list.pdf"), so a name
  // with spaces or Cyrillic would otherwise be saved as-is, escapes included.
  let filename = fallbackFilename
  if (match?.[1]) {
    try {
      filename = decodeURIComponent(match[1])
    } catch {
      filename = match[1]
    }
  }

  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}
