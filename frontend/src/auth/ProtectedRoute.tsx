import type { ReactNode } from "react"
import { Navigate } from "react-router-dom"
import { useAuth } from "./AuthContext"
import type { Role } from "./storage"

interface ProtectedRouteProps {
  /** Omit to just require "logged in, any role". */
  allowedRole?: Role
  children: ReactNode
}

const ROLE_HOME: Record<Role, string> = {
  ops: "/ops",
  client: "/client",
}

export function ProtectedRoute({ allowedRole, children }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return null
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (allowedRole && user.role !== allowedRole) {
    return <Navigate to={ROLE_HOME[user.role]} replace />
  }

  return <>{children}</>
}

// Users and Action log: ops administrators only. An ordinary ops user who
// types the address lands on the PI list instead of a 403 page. isAdmin still
// unknown (a session stored before it existed, refreshing from /auth/me)
// renders the page — the API decides.
export function AdminRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user?.isAdmin === false) {
    return <Navigate to="/ops/pi" replace />
  }
  return <>{children}</>
}
