import { SetMetadata } from "@nestjs/common";
import { Role } from "../enums/role.enum";

export const ROLES_KEY = "roles";

/**
 * Restricts a controller/handler to the given roles. Used on controllers
 * that are ops-only (client gets a 403 from RolesGuard on every method).
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
