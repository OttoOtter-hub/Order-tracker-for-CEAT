import { SetMetadata } from "@nestjs/common";

export const ADMIN_ONLY_KEY = "adminOnly";

/**
 * Restricts a controller/handler to ops admins (User.isAdmin). Use together
 * with @Roles(Role.OPS): a client still gets OPS_ONLY_ACTION, a non-admin ops
 * user gets ADMIN_ONLY_ACTION — see RolesGuard.
 */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY_KEY, true);
