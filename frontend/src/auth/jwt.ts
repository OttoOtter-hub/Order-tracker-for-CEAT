import type { Role } from "./storage"

export interface JwtPayload {
  sub: string
  email: string
  role: Role
  customerId: string | null
  iat?: number
  exp?: number
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Reads the JWT payload for UI purposes only (who is logged in, which
 * role) — this is not signature verification, the backend is still the
 * only party that trusts the token's authenticity. */
export function decodeJwt(token: string): JwtPayload | null {
  try {
    const payloadSegment = token.split(".")[1]
    if (!payloadSegment) return null
    return JSON.parse(base64UrlDecode(payloadSegment)) as JwtPayload
  } catch {
    return null
  }
}
