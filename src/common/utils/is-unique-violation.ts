/** Postgres SQLSTATE 23505 = unique_violation, surfaced by node-postgres/TypeORM as err.code. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505"
  );
}
