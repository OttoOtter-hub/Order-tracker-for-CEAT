import i18n from "@/i18n"
import { clearStoredSession, getStoredToken } from "@/auth/storage"

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000"

export type ApiErrorParams = Record<string, string | number>

/**
 * `message` is the server's own text; `code`/`params` (the backend's error
 * shape: { code, message, params? }) are what lib/errors.ts translates.
 */
export class ApiError extends Error {
  readonly status: number
  readonly body?: unknown
  readonly code?: string
  readonly params?: ApiErrorParams

  constructor(message: string, status: number, body?: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.body = body
    if (body && typeof body === "object") {
      const { code, params } = body as { code?: unknown; params?: unknown }
      if (typeof code === "string") {
        this.code = code
      }
      if (params && typeof params === "object" && !Array.isArray(params)) {
        this.params = params as ApiErrorParams
      }
    }
  }
}

/** The one place a failed response's JSON body becomes an ApiError. */
export function apiErrorFromBody(
  parsedBody: unknown,
  status: number,
  fallbackMessage: string
): ApiError {
  return new ApiError(extractErrorMessage(parsedBody, fallbackMessage), status, parsedBody)
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown }

function extractErrorMessage(parsedBody: unknown, fallback: string): string {
  if (!parsedBody || typeof parsedBody !== "object" || !("message" in parsedBody)) {
    return fallback
  }
  const message = (parsedBody as { message?: unknown }).message

  if (typeof message === "string") {
    return message
  }
  // class-validator 400s: message is string[]
  if (Array.isArray(message) && message.every((m) => typeof m === "string")) {
    return message.join("; ")
  }
  // e.g. ContainerTransitionService's incomplete-items payload: { message: string, ...details }
  if (
    message &&
    typeof message === "object" &&
    "message" in message &&
    typeof (message as { message?: unknown }).message === "string"
  ) {
    return (message as { message: string }).message
  }
  return fallback
}

/**
 * Thin fetch wrapper. Reads the token from localStorage rather than React
 * context because this module lives outside the component tree — the
 * context (AuthContext) is what the app renders from, localStorage is what
 * both the context and this client read/persist through, so the two never
 * disagree.
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers: headersInit, ...rest } = options
  const token = getStoredToken()
  // FormData (file uploads) must go through untouched — fetch sets its own
  // multipart boundary in Content-Type, and JSON.stringify would mangle it.
  const isFormData = body instanceof FormData

  const headers = new Headers(headersInit)
  if (body !== undefined && !isFormData) {
    headers.set("Content-Type", "application/json")
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers,
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  })

  if (response.status === 401) {
    clearStoredSession()
    if (window.location.pathname !== "/login") {
      window.location.assign("/login")
    }
    throw new ApiError("Unauthorized", 401)
  }

  // 403 goes the same way as every other error: the caller's onError shows
  // getErrorMessage(error), which translates the code (CLIENT_ONLY_ACTION,
  // OPS_ONLY_ACTION, …). No toast here, or the user would get two.
  if (!response.ok) {
    let parsedBody: unknown
    try {
      parsedBody = await response.json()
    } catch {
      parsedBody = undefined
    }
    const fallback =
      response.status === 403
        ? i18n.t("common.forbidden")
        : response.statusText || "Request failed"
    throw apiErrorFromBody(parsedBody, response.status, fallback)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "DELETE" }),
}
