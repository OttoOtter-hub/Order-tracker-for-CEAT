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
