import { getMetadataArgsStorage } from "typeorm";

type EntityClass = { name: string; prototype: object };

function inheritsFrom(cls: EntityClass, target: unknown): boolean {
  return (
    cls === target ||
    (typeof target === "function" && cls.prototype instanceof target)
  );
}

/**
 * Just enough of TypeORM's EntityMetadata for bulkUpdateById, read from the
 * entity's own decorators (no DataSource needed): table and column names,
 * many-to-one join columns, the primary key and the update-date column.
 */
function fakeMetadata(cls: EntityClass) {
  const storage = getMetadataArgsStorage();
  const table = storage.tables.find((t) => t.target === cls);
  const columns = storage.columns.filter((c) => inheritsFrom(cls, c.target));
  const joins = storage.joinColumns.filter((j) => inheritsFrom(cls, j.target));
  const describe = (c: (typeof columns)[number]) => ({
    propertyName: c.propertyName,
    databaseName: c.options.name ?? c.propertyName,
    type:
      typeof c.options.type === "string"
        ? c.options.type
        : c.mode === "createDate" || c.mode === "updateDate"
          ? "timestamptz"
          : "text",
  });
  const updateDate = columns.find((c) => c.mode === "updateDate");
  return {
    name: cls.name,
    tableName: table?.name ?? cls.name,
    findRelationWithPropertyPath: (property: string) => {
      const join = joins.find((j) => j.propertyName === property);
      return join
        ? {
            joinColumns: [
              {
                databaseName: join.name ?? property,
                referencedColumn: { type: "uuid" },
              },
            ],
          }
        : undefined;
    },
    findColumnWithPropertyPath: (property: string) => {
      const column = columns.find((c) => c.propertyName === property);
      return column ? describe(column) : undefined;
    },
    primaryColumns: [{ databaseName: "id", type: "uuid" }],
    updateDateColumn: updateDate ? describe(updateDate) : undefined,
    /** Database column name -> the property that holds it (a relation: { id }). */
    propertyOf(databaseName: string) {
      const join = joins.find(
        (j) => (j.name ?? j.propertyName) === databaseName,
      );
      if (join) {
        return { property: join.propertyName, isRelation: true };
      }
      const column = columns.find(
        (c) => (c.options.name ?? c.propertyName) === databaseName,
      );
      return column
        ? { property: column.propertyName, isRelation: false }
        : null;
    },
  };
}

const BULK_UPDATE =
  /^UPDATE "(\w+)" AS t SET .+? FROM \(VALUES .+\) AS v\((.+?)\) WHERE t\."id" = v\."id"$/s;

/**
 * Stand-in for TypeORM's DataSource for services that run their writes
 * through `dataSource.transaction(em => ...)` and resolve repositories with
 * `em.getRepository(Entity)`. Each entity class maps to a makeFakeRepo();
 * there is no real rollback — specs assert on the resulting rows instead.
 *
 * `em.query` understands the two raw statements the services send: the
 * upload's advisory lock (recorded in `queries`, no effect) and
 * bulkUpdateById's UPDATE … FROM (VALUES …), applied to the matching fake
 * repo's rows. Anything else throws, so a new raw query can't pass silently.
 */
export function makeFakeDataSource(repos: Map<unknown, unknown>) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const entityOfTable = (tableName: string) =>
    [...repos.keys()].find(
      (cls) => fakeMetadata(cls as EntityClass).tableName === tableName,
    ) as EntityClass | undefined;

  const manager = {
    getRepository: (entity: unknown) => {
      const repo = repos.get(entity);
      if (!repo) {
        throw new Error(
          `fake-data-source: no fake repo registered for ${(entity as { name?: string })?.name ?? String(entity)}`,
        );
      }
      return repo as any;
    },
    connection: {
      getMetadata: (entity: unknown) => fakeMetadata(entity as EntityClass),
      driver: { normalizeType: (column: { type: string }) => column.type },
    },
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (/^SELECT pg_advisory_xact_lock\(/.test(sql)) {
        return [];
      }
      const bulk = BULK_UPDATE.exec(sql);
      if (!bulk) {
        throw new Error(`fake-data-source: unsupported raw query: ${sql}`);
      }
      const cls = entityOfTable(bulk[1]);
      if (!cls) {
        throw new Error(`fake-data-source: no fake repo for table ${bulk[1]}`);
      }
      const meta = fakeMetadata(cls);
      const names = bulk[2].split(",").map((n) => n.trim().replace(/"/g, ""));
      const rows = (repos.get(cls) as { rows: Record<string, unknown>[] }).rows;
      for (let i = 0; i < params.length; i += names.length) {
        const tuple = params.slice(i, i + names.length);
        const row = rows.find((r) => r.id === tuple[0]);
        if (!row) {
          continue;
        }
        names.slice(1).forEach((name, n) => {
          const target = meta.propertyOf(name);
          if (!target) {
            throw new Error(
              `fake-data-source: ${bulk[1]}.${name} is no column`,
            );
          }
          row[target.property] = target.isRelation
            ? { id: tuple[n + 1] }
            : tuple[n + 1];
        });
      }
      return [];
    }),
  };
  return {
    manager,
    queries,
    transaction: jest.fn(
      async <R>(work: (em: typeof manager) => Promise<R>): Promise<R> =>
        work(manager),
    ),
  };
}
