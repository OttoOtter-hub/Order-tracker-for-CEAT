import { Role } from "../enums/role.enum";

export interface RequestUser {
  id: string;
  email: string;
  role: Role;
  customerId: string | null;
}
