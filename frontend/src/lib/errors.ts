import { ApiError } from "@/api/client"

export function getErrorMessage(error: unknown, fallback = "Что-то пошло не так"): string {
  if (error instanceof ApiError) {
    return error.message
  }
  return fallback
}
