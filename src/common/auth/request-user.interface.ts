import { Role } from "../enums/role.enum";

export interface RequestUser {
  id: string;
  email: string;
  role: Role;
  customerId: string | null;
  /**
   * Ops admin (user management, action log). Set by JwtStrategy from the
   * database, not from the token, so a change applies without a new login.
   * Absent counts as false.
   */
  isAdmin?: boolean;
}
