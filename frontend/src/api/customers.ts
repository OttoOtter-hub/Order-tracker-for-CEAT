import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/api/client"
import type { Customer } from "@/api/types"

export function useCustomersQuery() {
  return useQuery({
    queryKey: ["customers"],
    queryFn: () => apiClient.get<Customer[]>("/customers"),
    staleTime: 60_000,
  })
}
