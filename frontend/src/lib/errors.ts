import { ApiError } from "@/api/client"
import i18n from "@/i18n"

/**
 * The single place an API error becomes user-facing text: the translation of
 * its code (errors.<CODE>, with the server's params filled in) when the
 * dictionary has one, otherwise the server's own message. UNKNOWN_ERROR is
 * deliberately untranslated, so it always shows the server's text.
 */
export function getErrorMessage(error: unknown, fallback = i18n.t("common.somethingWrong")): string {
  if (error instanceof ApiError) {
    const key = `errors.${error.code}`
    if (error.code && i18n.exists(key)) {
      return i18n.t(key, error.params ?? {})
    }
    return error.message
  }
  return fallback
}

/**
 * Phase 25: the list an error carries along (each bad row of an uploaded
 * file, each mismatch of the client's version), one line per item, in the
 * server's order: "Row 12: …" when the item names a row.
 */
export function getErrorDetailMessages(error: unknown): string[] {
  if (!(error instanceof ApiError)) return []
  return error.details.map((detail) => {
    const key = `errors.${detail.code}`
    const text = i18n.exists(key)
      ? i18n.t(key, detail.params ?? {})
      : detail.code
    return detail.row === undefined
      ? text
      : i18n.t("common.atRow", { row: detail.row, text })
  })
}
