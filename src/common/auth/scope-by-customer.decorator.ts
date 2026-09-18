import { SetMetadata } from "@nestjs/common";

export const SCOPE_BY_CUSTOMER_KEY = "scopeByCustomer";

/**
 * Declares the dot-path from this controller's entity to the customer id
 * it belongs to (e.g. 'customer.id', 'pi.customer.id'). CustomerScopeInterceptor
 * uses this to filter list/detail responses to the requesting client's own data.
 * No effect for the ops role.
 */
export const ScopeByCustomer = (path: string) =>
  SetMetadata(SCOPE_BY_CUSTOMER_KEY, path);
