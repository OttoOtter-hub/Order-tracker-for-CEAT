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
import { AuditLogService } from "../audit-log/audit-log.service";
import { Customer } from "../customers/customer.entity";
import { User } from "./user.entity";

/** Same cost as the seed script (src/seed/create-user.ts). */
export const PASSWORD_HASH_ROUNDS = 10;

/**
 * How long a user's "is active / is admin" answer is trusted before
 * JwtStrategy asks the database again. Deactivate/reactivate/set-admin write
 * through the cache, so on
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
  isAdmin: boolean;
  createdAt: Date;
}

/** What JwtStrategy needs to know about the token's user on every request. */
export interface AuthStatus {
  active: boolean;
  isAdmin: boolean;
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
    isAdmin: user.role === Role.OPS && !!user.isAdmin,
    createdAt: user.createdAt,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  private readonly statusCache = new Map<
    string,
    AuthStatus & { checkedAt: number }
  >();

  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    private readonly audit: AuditLogService,
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
   * An admin creates a login. A client must belong to an existing customer;
   * an ops user never does (a customerId sent along for ops is ignored).
   * isAdmin (default false) is for ops only — 400 for a client. The email is
   * stored trimmed and lower-cased.
   */
  async create(
    dto: {
      email: string;
      password: string;
      role: Role;
      customerId?: string;
      isAdmin?: boolean;
    },
    actor: RequestUser,
  ): Promise<UserView> {
    const email = normalizeEmail(dto.email);
    const isAdmin = dto.isAdmin === true;
    if (isAdmin && dto.role !== Role.OPS) {
      throw new BadRequestException(
        apiError("ADMIN_REQUIRES_OPS", "only an ops user can be an admin"),
      );
    }
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
          isAdmin,
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
    await this.audit.record({
      actor,
      action: "user.created",
      entityType: "user",
      entityId: saved.id,
      metadata: {
        email,
        role: dto.role,
        customerName: customer?.name ?? null,
        isAdmin,
      },
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
    const wasActive = user.isActive;
    await this.repo.update({ id }, { isActive: active });
    this.statusCache.set(id, {
      active,
      isAdmin: user.role === Role.OPS && !!user.isAdmin,
      checkedAt: Date.now(),
    });
    user.isActive = active;
    // Journaled only on an actual change — a repeated click is a no-op.
    if (wasActive !== active) {
      await this.audit.record({
        actor,
        action: active ? "user.reactivated" : "user.deactivated",
        entityType: "user",
        entityId: user.id,
        metadata: { email: user.email, role: user.role },
      });
    }
    return toView(user);
  }

  /**
   * Grant or revoke admin. Only an ops user can be one (400
   * ADMIN_REQUIRES_OPS). The last *active* admin keeps it — whoever asks,
   * themselves included — or nobody could manage users any more (400
   * LAST_ADMIN); the same "never lock everyone out" rule as deactivation.
   * Setting the value it already has is a no-op (nothing journaled).
   */
  async setAdmin(
    id: string,
    isAdmin: boolean,
    actor: RequestUser,
  ): Promise<UserView> {
    const user = await this.repo.findOne({
      where: { id },
      relations: ["customer"],
    });
    if (!user) {
      throw new NotFoundException(
        apiError("NOT_FOUND", `User ${id} not found`),
      );
    }
    if (user.role !== Role.OPS) {
      throw new BadRequestException(
        apiError("ADMIN_REQUIRES_OPS", "only an ops user can be an admin"),
      );
    }
    if (!!user.isAdmin === isAdmin) {
      return toView(user);
    }
    if (!isAdmin && user.isActive) {
      const activeAdmins = await this.repo.count({
        where: { role: Role.OPS, isAdmin: true, isActive: true },
      });
      if (activeAdmins <= 1) {
        throw new BadRequestException(
          apiError(
            "LAST_ADMIN",
            "this is the last active administrator — make someone else an admin first",
          ),
        );
      }
    }
    await this.repo.update({ id }, { isAdmin });
    user.isAdmin = isAdmin;
    this.statusCache.set(id, {
      active: user.isActive,
      isAdmin,
      checkedAt: Date.now(),
    });
    await this.audit.record({
      actor,
      action: isAdmin ? "user.admin_granted" : "user.admin_revoked",
      entityType: "user",
      entityId: user.id,
      metadata: { email: user.email },
    });
    return toView(user);
  }

  /**
   * Whether this user may still use the app, and whether they are an ops
   * admin. Cached per user for ACTIVE_CACHE_TTL_MS; an unknown id counts as
   * inactive (and not an admin).
   */
  async getAuthStatus(id: string): Promise<AuthStatus> {
    const hit = this.statusCache.get(id);
    if (hit && Date.now() - hit.checkedAt < ACTIVE_CACHE_TTL_MS) {
      return { active: hit.active, isAdmin: hit.isAdmin };
    }
    const user = await this.repo.findOne({ where: { id } });
    const status: AuthStatus = {
      active: !!user?.isActive,
      isAdmin: !!user && user.role === Role.OPS && !!user.isAdmin,
    };
    this.statusCache.set(id, { ...status, checkedAt: Date.now() });
    return status;
  }

  async isActive(id: string): Promise<boolean> {
    return (await this.getAuthStatus(id)).active;
  }

  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.repo.update({ id }, { passwordHash });
  }
}
