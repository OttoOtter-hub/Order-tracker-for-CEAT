import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import * as bcrypt from "bcryptjs";
import { Repository } from "typeorm";
import { RequestUser } from "../common/auth/request-user.interface";
import { Role } from "../common/enums/role.enum";
import { apiError } from "../common/errors/api-error";
import { isUniqueViolation } from "../common/utils/is-unique-violation";
import { Customer } from "../customers/customer.entity";
import { User } from "./user.entity";

/** Same cost as the seed script (src/seed/create-user.ts). */
export const PASSWORD_HASH_ROUNDS = 10;

/**
 * How long a user's "is active" answer is trusted before JwtStrategy asks
 * the database again. Deactivate/reactivate write through the cache, so on
 * this (single-process) server the change is immediate; the TTL only bounds
 * staleness if that ever stops being true — while keeping the per-request
 * cost at one query per user per minute, not one per request.
 */
export const ACTIVE_CACHE_TTL_MS = 60_000;

/** One row of GET /users — never the password hash. */
export interface UserView {
  id: string;
  email: string;
  role: Role;
  customer: { id: string; name: string } | null;
  isActive: boolean;
  createdAt: Date;
}

function toView(user: User): UserView {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    customer: user.customer
      ? { id: user.customer.id, name: user.customer.name }
      : null,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  private readonly activeCache = new Map<
    string,
    { active: boolean; checkedAt: number }
  >();

  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email }, relations: ["customer"] });
  }

  findById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** Every active ops user — recipients for notifications ops-wide, not scoped to one customer. */
  findOpsUsers(): Promise<User[]> {
    return this.repo.find({ where: { role: Role.OPS, isActive: true } });
  }

  /** Every active client user tied to this one customer — recipients for a customer-specific notification. */
  findClientUsers(customerId: string): Promise<User[]> {
    return this.repo.find({
      where: {
        role: Role.CLIENT,
        customer: { id: customerId },
        isActive: true,
      },
    });
  }

  async findAll(): Promise<UserView[]> {
    const users = await this.repo.find({
      relations: ["customer"],
      order: { createdAt: "ASC" },
    });
    return users.map(toView);
  }

  /**
   * Ops creates a login. A client must belong to an existing customer; an
   * ops user never does (a customerId sent along for ops is ignored). The
   * email is stored trimmed and lower-cased.
   */
  async create(dto: {
    email: string;
    password: string;
    role: Role;
    customerId?: string;
  }): Promise<UserView> {
    const email = normalizeEmail(dto.email);
    let customer: Customer | null = null;
    if (dto.role === Role.CLIENT) {
      if (!dto.customerId) {
        throw new BadRequestException(
          apiError(
            "CUSTOMER_REQUIRED_FOR_CLIENT",
            "customerId is required for a client user",
          ),
        );
      }
      customer = await this.customerRepo.findOne({
        where: { id: dto.customerId },
      });
      if (!customer) {
        throw new NotFoundException(
          apiError("NOT_FOUND", `Customer ${dto.customerId} not found`),
        );
      }
    }

    if (await this.repo.findOne({ where: { email } })) {
      throw new ConflictException(
        apiError("EMAIL_TAKEN", `User ${email} already exists`, { email }),
      );
    }

    let saved: User;
    try {
      saved = await this.repo.save(
        this.repo.create({
          email,
          passwordHash: await bcrypt.hash(dto.password, PASSWORD_HASH_ROUNDS),
          role: dto.role,
          customer,
          isActive: true,
        }),
      );
    } catch (err) {
      // Two simultaneous creates of the same email: the unique index wins.
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          apiError("EMAIL_TAKEN", `User ${email} already exists`, { email }),
        );
      }
      throw err;
    }
    const created = await this.repo.findOne({
      where: { id: saved.id },
      relations: ["customer"],
    });
    return toView(created ?? saved);
  }

  /**
   * Deactivate or reactivate — the row is never deleted. Nobody can
   * deactivate themselves (that would also let the last active ops lock
   * everyone out).
   */
  async setActive(
    id: string,
    active: boolean,
    actor: RequestUser,
  ): Promise<UserView> {
    if (!active && id === actor.id) {
      throw new BadRequestException(
        apiError("CANNOT_DEACTIVATE_SELF", "you cannot deactivate yourself"),
      );
    }
    const user = await this.repo.findOne({
      where: { id },
      relations: ["customer"],
    });
    if (!user) {
      throw new NotFoundException(
        apiError("NOT_FOUND", `User ${id} not found`),
      );
    }
    await this.repo.update({ id }, { isActive: active });
    this.activeCache.set(id, { active, checkedAt: Date.now() });
    user.isActive = active;
    return toView(user);
  }

  /**
   * Whether this user may still use the app. Cached per user for
   * ACTIVE_CACHE_TTL_MS; an unknown id counts as inactive.
   */
  async isActive(id: string): Promise<boolean> {
    const hit = this.activeCache.get(id);
    if (hit && Date.now() - hit.checkedAt < ACTIVE_CACHE_TTL_MS) {
      return hit.active;
    }
    const user = await this.repo.findOne({ where: { id } });
    const active = !!user?.isActive;
    this.activeCache.set(id, { active, checkedAt: Date.now() });
    return active;
  }

  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.repo.update({ id }, { passwordHash });
  }
}
