/**
 * Lightweight in-memory stand-in for a TypeORM Repository, used across
 * this project's service specs instead of a real DB or a heavy mocking
 * framework. Understands the `where` shapes those services actually use:
 * flat ({ id }, { piNumber }) and one level of relation nesting
 * ({ pi: { id } }).
 */
export function makeFakeRepo<
  T extends { id?: string } & Record<string, any>,
>() {
  const rows: T[] = [];
  let nextId = 1;

  function matches(row: any, where: Record<string, any>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value && typeof value === "object" && !(value instanceof Date)) {
        return matches(row?.[key] ?? {}, value);
      }
      return row?.[key] === value;
    });
  }

  function upsert(entity: T): T {
    if (!entity.id) {
      entity.id = `generated-${nextId++}`;
    }
    const idx = rows.findIndex((r) => r.id === entity.id);
    if (idx >= 0) {
      rows[idx] = { ...rows[idx], ...entity };
    } else {
      rows.push({ ...entity });
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
    findOne: jest.fn(async ({ where }: { where: Record<string, any> }) => {
      return rows.find((r) => matches(r, where)) ?? null;
    }),
    find: jest.fn(
      async (opts?: {
        where?: Record<string, any>;
        order?: Record<string, "ASC" | "DESC">;
        take?: number;
      }) => {
        let result = opts?.where
          ? rows.filter((r) => matches(r, opts.where!))
          : [...rows];
        const orderEntry = opts?.order && Object.entries(opts.order)[0];
        if (orderEntry) {
          const [key, direction] = orderEntry;
          result = [...result].sort((a, b) => {
            const av = a[key];
            const bv = b[key];
            const cmp = av > bv ? 1 : av < bv ? -1 : 0;
            return direction === "DESC" ? -cmp : cmp;
          });
        }
        if (opts?.take !== undefined) {
          result = result.slice(0, opts.take);
        }
        return result;
      },
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
