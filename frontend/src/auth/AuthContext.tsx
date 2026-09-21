import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { apiClient } from "@/api/client"
import { decodeJwt } from "./jwt"
import {
  clearStoredSession,
  getStoredToken,
  getStoredUser,
  setStoredSession,
  type AuthUser,
} from "./storage"

interface LoginResponse {
  accessToken: string
}

interface AuthContextValue {
  user: AuthUser | null
  /** True until the initial localStorage restore has run — lets
   * ProtectedRoute avoid redirecting to /login for a split second before
   * a persisted session has been read. */
  isLoading: boolean
  login: (email: string, password: string) => Promise<AuthUser>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const storedToken = getStoredToken()
    const storedUser = getStoredUser()
    if (storedToken && storedUser) {
      setUser(storedUser)
    }
    setIsLoading(false)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const { accessToken } = await apiClient.post<LoginResponse>("/auth/login", {
      email,
      password,
    })
    const payload = decodeJwt(accessToken)
    if (!payload) {
      // Never shown: LoginPage turns any non-401 failure into its own message.
      throw new Error("The server returned an invalid token")
    }
    const authUser: AuthUser = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      customerId: payload.customerId,
    }
    setStoredSession(accessToken, authUser)
    setUser(authUser)
    return authUser
  }, [])

  const logout = useCallback(() => {
    clearStoredSession()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, isLoading, login, logout }),
    [user, isLoading, login, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
