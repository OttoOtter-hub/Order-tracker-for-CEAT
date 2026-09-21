import { ApiError } from "@/api/client"
import i18n from "@/i18n"

export function getErrorMessage(error: unknown, fallback = i18n.t("common.somethingWrong")): string {
  if (error instanceof ApiError) {
    return error.message
  }
  return fallback
}
