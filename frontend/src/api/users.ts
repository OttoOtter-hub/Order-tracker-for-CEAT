import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/api/client"
import type { Role } from "@/auth/storage"

// Mirrors the backend's MIN_PASSWORD_LENGTH (users/dto/create-user.dto.ts);
// the form checks it up front, the API enforces it (PASSWORD_TOO_SHORT).
export const MIN_PASSWORD_LENGTH = 8

// GET /users row — ops administrators only, never the password hash.
export interface ManagedUser {
  id: string
  email: string
  role: Role
  customer: { id: string; name: string } | null
  isActive: boolean
  // Ops administrator; always false for a client.
  isAdmin: boolean
  createdAt: string
}

export interface NewUser {
  email: string
  password: string
  role: Role
  customerId?: string
  // Ops only (the API answers 400 for a client).
  isAdmin?: boolean
}

const USERS_KEY = ["users"]

export function useUsersQuery() {
  return useQuery({
    queryKey: USERS_KEY,
    queryFn: () => apiClient.get<ManagedUser[]>("/users"),
    staleTime: 30_000,
  })
}

export function useCreateUserMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (user: NewUser) => apiClient.post<ManagedUser>("/users", user),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_KEY }),
  })
}

// PATCH /users/:id/deactivate | /reactivate — the row is never deleted.
export function useSetUserActiveMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiClient.patch<ManagedUser>(
        `/users/${id}/${active ? "reactivate" : "deactivate"}`
      ),
    onSuccess: (updated) =>
      queryClient.setQueryData<ManagedUser[]>(USERS_KEY, (list) =>
        list?.map((user) => (user.id === updated.id ? updated : user))
      ),
  })
}

// PATCH /users/:id/set-admin — grant/revoke; the last active admin is
// refused by the API (LAST_ADMIN).
export function useSetUserAdminMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, isAdmin }: { id: string; isAdmin: boolean }) =>
      apiClient.patch<ManagedUser>(`/users/${id}/set-admin`, { isAdmin }),
    onSuccess: (updated) =>
      queryClient.setQueryData<ManagedUser[]>(USERS_KEY, (list) =>
        list?.map((user) => (user.id === updated.id ? updated : user))
      ),
  })
}

// POST /auth/change-password — always the logged-in user's own password.
export function useChangePasswordMutation() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      apiClient.post<void>("/auth/change-password", body),
  })
}
