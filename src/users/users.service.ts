import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Role } from "../common/enums/role.enum";
import { User } from "./user.entity";

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email }, relations: ["customer"] });
  }

  /** Every ops user — recipients for notifications ops-wide, not scoped to one customer. */
  findOpsUsers(): Promise<User[]> {
    return this.repo.find({ where: { role: Role.OPS } });
  }

  /** Every client user tied to this one customer — recipients for a customer-specific notification. */
  findClientUsers(customerId: string): Promise<User[]> {
    return this.repo.find({
      where: { role: Role.CLIENT, customer: { id: customerId } },
    });
  }
}
