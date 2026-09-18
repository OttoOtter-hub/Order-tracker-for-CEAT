import { SetMetadata } from "@nestjs/common";

export const CLIENT_WRITE_ALLOWED_KEY = "clientWriteAllowed";

/**
 * Whitelists a non-GET handler for the client role. Client is otherwise
 * read-only everywhere (enforced by RolesGuard) — this is the narrow
 * exception for confirming/commenting on a container plan.
 */
export const ClientWriteAllowed = () =>
  SetMetadata(CLIENT_WRITE_ALLOWED_KEY, true);
