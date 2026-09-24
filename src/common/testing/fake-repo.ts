import { FindOperator } from "typeorm";

/**
 * Lightweight in-memory stand-in for a TypeORM Repository, used across
 * this project's service specs instead of a real DB or a heavy mocking
 * framework. Understands the `where` shapes those services actually use:
 * flat ({ id }, { piNumber }), nested relations ({ pi: { customer: { id } } })
 * the `In([...])`, `MoreThanOrEqual`, `LessThan` and `And(...)` operators at
 * any depth, and an array of those (OR) for find/findOne/count. find and
 * findAndCount also honour order (several keys), skip and take.
 *
 * Rows hold relations exactly as they were written (a service typically
 * writes a bare `{ id }` reference). `relationRepos` lets a spec say which
 * other fake repo backs a relation property; when a find/findOne asks for
 * that property in `relations`, the returned copy has the bare reference
 * replaced by the referenced row — what a real join would give. Only the
 * first segment of a dotted path ("piLineItem.pi") is resolved; deeper
 * levels are whatever the referenced row already embeds.
 */
export function makeFakeRepo<T extends { id?: string } & Record<string, any>>(
  relationRepos: Record<string, () => { rows: any[] }> = {},
) {
  const rows: T[] = [];
  let nextId = 1;

  function hydrate(row: T, relations?: string[]): T {
    if (!relations?.length) {
      return row;
    }
    // Object.assign onto a fresh object sharing row's prototype (not a
    // plain {...row} spread) — a seeded row is often a real entity instance
    // (e.g. ActualContainer, for its arrivalStatus getter); a plain spread
    // would silently drop such getters, since they live on the prototype,
    // not as own properties.
    const hydrated: Record<string, any> = Object.assign(
      Object.create(Object.getPrototypeOf(row) as object),
      row,
    );
    for (const path of relations) {
      const property = path.split(".")[0];
      const target = relationRepos[property];
      const reference = row[property];
      if (target && reference?.id !== undefined) {
        const resolved = target().rows.find((r) => r.id === reference.id);
        if (resolved) {
          hydrated[property] = resolved;
        }
      }
    }
    return hydrated as T;
  }

  function comparable(value: unknown): unknown {
    return value instanceof Date ? value.getTime() : value;
  }

  function matchesOperator(
    actual: unknown,
    operator: FindOperator<unknown>,
  ): boolean {
    const a = comparable(actual) as number | string;
    switch (operator.type) {
      case "in":
        return (operator.value as unknown[]).includes(actual);
      case "moreThanOrEqual":
        return a >= (comparable(operator.value) as number | string);
      case "lessThan":
        return a < (comparable(operator.value) as number | string);
      case "and":
        return (operator.value as unknown as FindOperator<unknown>[]).every(
          (inner) => matchesOperator(actual, inner),
        );
      default:
        throw new Error(
          `fake-repo: unsupported FindOperator "${operator.type}"`,
        );
    }
  }

  function matches(row: any, where: Record<string, any>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value instanceof FindOperator) {
        return matchesOperator(row?.[key], value);
      }
      if (value && typeof value === "object" && !(value instanceof Date)) {
        return matches(row?.[key] ?? {}, value);
      }
      return row?.[key] === value;
    });
  }

  // A `where` array is TypeORM's OR: any one of the objects may match.
  function matchesWhere(
    row: any,
    where: Record<string, any> | Record<string, any>[],
  ): boolean {
    return Array.isArray(where)
      ? where.some((w) => matches(row, w))
      : matches(row, where);
  }

  interface FindOpts {
    where?: Record<string, any>;
    relations?: string[];
    order?: Record<string, "ASC" | "DESC">;
    skip?: number;
    take?: number;
  }

  /** where -> order (every key, in turn) -> skip/take; total is before paging. */
  function query(opts?: FindOpts): { page: T[]; total: number } {
    let result = opts?.where
      ? rows.filter((r) => matchesWhere(r, opts.where!))
      : [...rows];
    const orderEntries = opts?.order ? Object.entries(opts.order) : [];
    if (orderEntries.length) {
      result = [...result].sort((a, b) => {
        for (const [key, direction] of orderEntries) {
          const av = comparable(a[key]) as number | string;
          const bv = comparable(b[key]) as number | string;
          const cmp = av > bv ? 1 : av < bv ? -1 : 0;
          if (cmp !== 0) {
            return direction === "DESC" ? -cmp : cmp;
          }
        }
        return 0;
      });
    }
    const total = result.length;
    const start = opts?.skip ?? 0;
    result = result.slice(
      start,
      opts?.take !== undefined ? start + opts.take : undefined,
    );
    return {
      page: result.map((row) => hydrate(row, opts?.relations)),
      total,
    };
  }

  function upsert(entity: T): T {
    if (!entity.id) {
      entity.id = `generated-${nextId++}`;
    }
    const idx = rows.findIndex((r) => r.id === entity.id);
    if (idx >= 0) {
      rows[idx] = Object.assign(
        Object.create(Object.getPrototypeOf(rows[idx]) as object),
        rows[idx],
        entity,
      );
    } else {
      rows.push(
        Object.assign(
          Object.create(Object.getPrototypeOf(entity) as object),
          entity,
        ),
      );
    }
    return rows.find((r) => r.id === entity.id)!;
  }

  return {
    create: jest.fn((data: Partial<T>) => ({ ...data }) as T),
    save: jest.fn(async (entityOrEntities: T | T[]) => {
      if (Array.isArray(entityOrEntities)) {
        return entityOrEntities.map(upsert);
      }
      return upsert(entityOrEntities);
    }),
    findOne: jest.fn(
      async ({
        where,
        relations,
      }: {
        where: Record<string, any>;
        relations?: string[];
      }) => {
        const found = rows.find((r) => matchesWhere(r, where));
        return found ? hydrate(found, relations) : null;
      },
    ),
    find: jest.fn(async (opts?: FindOpts) => query(opts).page),
    findAndCount: jest.fn(async (opts?: FindOpts) => {
      const { page, total } = query(opts);
      return [page, total] as const;
    }),
    count: jest.fn(async (opts?: { where?: Record<string, any> }) =>
      opts?.where
        ? rows.filter((r) => matchesWhere(r, opts.where!)).length
        : rows.length,
    ),
    delete: jest.fn(async (where: Record<string, any>) => {
      const toRemove = rows.filter((r) => matches(r, where));
      for (const r of toRemove) {
        const idx = rows.indexOf(r);
        if (idx >= 0) {
          rows.splice(idx, 1);
        }
      }
      return { affected: toRemove.length };
    }),
    update: jest.fn(async (where: Record<string, any>, partial: Partial<T>) => {
      const toUpdate = rows.filter((r) => matches(r, where));
      for (const r of toUpdate) {
        Object.assign(r, partial);
      }
      return { affected: toUpdate.length };
    }),
    seed(row: T) {
      rows.push(row);
    },
    rows,
  };
}
