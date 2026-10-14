import { EntityManager, EntityTarget, ObjectLiteral } from "typeorm";

export type BulkValue = string | number | boolean | null;

export interface BulkUpdateRow {
  id: string;
  /**
   * Property name -> new value. A many-to-one relation is given by property
   * name too ("piLineItem") with the referenced id as the value. Every row
   * of one call must set the same properties.
   */
  values: Record<string, BulkValue>;
}

/** Rows per statement: 500 × a few columns stays far below Postgres' 65 535 parameters. */
const BULK_UPDATE_CHUNK = 500;

/**
 * Different values for many rows in one statement per chunk, instead of one
 * UPDATE (and, through save(), one SELECT) per row:
 *
 *   UPDATE "t" AS t SET "c" = v."c", "updated_at" = now()
 *   FROM (VALUES ($1::uuid, $2::numeric), …) AS v("id", "c")
 *   WHERE t."id" = v."id"
 *
 * Every row is a round trip to the database otherwise — ~110 ms from the VPS
 * to Neon — which is what made a backorder upload run into the proxy
 * timeout. Column names and types come from the entity's TypeORM metadata.
 */
export async function bulkUpdateById<T extends ObjectLiteral>(
  em: EntityManager,
  entity: EntityTarget<T>,
  rows: BulkUpdateRow[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const meta = em.connection.getMetadata(entity);
  const driver = em.connection.driver;
  const properties = Object.keys(rows[0].values);
  const columns = properties.map((property) => {
    const relation = meta.findRelationWithPropertyPath(property);
    const joinColumn = relation?.joinColumns[0];
    const column = joinColumn ?? meta.findColumnWithPropertyPath(property);
    if (!column) {
      throw new Error(`bulkUpdateById: ${meta.name}.${property} is no column`);
    }
    const typed = joinColumn?.referencedColumn ?? column;
    return { name: column.databaseName, type: driver.normalizeType(typed) };
  });
  const primary = meta.primaryColumns[0];
  const idType = driver.normalizeType(primary);
  const assignments = columns.map((c) => `"${c.name}" = v."${c.name}"`);
  if (meta.updateDateColumn) {
    assignments.push(`"${meta.updateDateColumn.databaseName}" = now()`);
  }
  const valueNames = ["id", ...columns.map((c) => c.name)]
    .map((name) => `"${name}"`)
    .join(", ");

  for (let start = 0; start < rows.length; start += BULK_UPDATE_CHUNK) {
    const chunk = rows.slice(start, start + BULK_UPDATE_CHUNK);
    const params: BulkValue[] = [];
    const placeholder = (value: BulkValue, type: string) => {
      params.push(value);
      return `$${params.length}::${type}`;
    };
    const tuples = chunk.map((row) => {
      const missing = properties.filter((p) => !(p in row.values));
      if (missing.length > 0) {
        throw new Error(
          `bulkUpdateById: row ${row.id} lacks ${missing.join(", ")}`,
        );
      }
      const cells = [
        placeholder(row.id, idType),
        ...properties.map((p, i) =>
          placeholder(row.values[p], columns[i].type),
        ),
      ];
      return `(${cells.join(", ")})`;
    });
    await em.query(
      `UPDATE "${meta.tableName}" AS t SET ${assignments.join(", ")} ` +
        `FROM (VALUES ${tuples.join(", ")}) AS v(${valueNames}) ` +
        `WHERE t."${primary.databaseName}" = v."id"`,
      params,
    );
  }
}
