import { createContext, useContext } from "react"

// The customer the page shows: the one ops picked, undefined for a client
// (whose token scopes every call). Every write hook on the page takes it.
export const ReadyToShipCustomerContext = createContext<string | undefined>(
  undefined
)

export function useReadyToShipCustomer(): string | undefined {
  return useContext(ReadyToShipCustomerContext)
}
