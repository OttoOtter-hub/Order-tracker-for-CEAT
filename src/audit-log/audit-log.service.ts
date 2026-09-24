import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  And,
  EntityManager,
  FindOperator,
  FindOptionsWhere,
  LessThan,
  MoreThanOrEqual,
  Repository,
} from "typeorm";
import { User } from "../users/user.entity";
import { AuditAction, AuditEntityType } from "./audit-actions";
import { AuditLog } from "./audit-log.entity";

export interface AuditEntry {
  /** Who did it — anything carrying the user's id (a RequestUser works). */
  actor: { id: string };
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditLogQuery {
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  action?: string;
  /** Inclusive lower bound on created_at. */
  from?: Date;
  /** Exclusive upper bound on created_at. */
  to?: Date;
  page: number;
  pageSize: number;
}

export interface AuditLogView {
  id: string;
  createdAt: Date;
  actor: { id: string; email: string } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
}

export interface AuditLogPage {
  items: AuditLogView[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * The action journal (Phase 20b). `record` is called at the end of every
 * journaled write:
 *
 * - with the write's own transaction (`em`) when it has one — the entry and
 *   the change commit together or not at all, and a failure to journal
 *   fails the action (no untraced change);
 * - without one, after the write has already been saved — then a journal
 *   failure is logged, not thrown: the user's action did happen, and
 *   answering it with an error would only invite a duplicate retry.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger("AuditLog");

  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  async record(entry: AuditEntry, em?: EntityManager): Promise<void> {
    const row = {
      actor: { id: entry.actor.id } as User,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata ?? {},
    };
    if (em) {
      const repo = em.getRepository(AuditLog);
      await repo.save(repo.create(row));
      return;
    }
    try {
      await this.repo.save(this.repo.create(row));
    } catch (err) {
      this.logger.error(
        `could not record ${entry.action} on ${entry.entityType} ${entry.entityId ?? ""}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Newest first, one page at a time — the table only ever grows. */
  async find(query: AuditLogQuery): Promise<AuditLogPage> {
    const where: FindOptionsWhere<AuditLog> = {};
    if (query.entityType) where.entityType = query.entityType;
    if (query.entityId) where.entityId = query.entityId;
    if (query.action) where.action = query.action;
    if (query.actorUserId) where.actor = { id: query.actorUserId };
    const range: FindOperator<Date>[] = [];
    if (query.from) range.push(MoreThanOrEqual(query.from));
    if (query.to) range.push(LessThan(query.to));
    if (range.length) {
      where.createdAt = range.length === 1 ? range[0] : And(...range);
    }

    const [rows, total] = await this.repo.findAndCount({
      where,
      relations: ["actor"],
      order: { createdAt: "DESC", id: "DESC" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        actor: row.actor ? { id: row.actor.id, email: row.actor.email } : null,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        metadata: row.metadata,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
