/**
 * Stand-in for TypeORM's DataSource for services that run their writes
 * through `dataSource.transaction(em => ...)` and resolve repositories with
 * `em.getRepository(Entity)`. Each entity class maps to a makeFakeRepo();
 * there is no real rollback — specs assert on the resulting rows instead.
 */
export function makeFakeDataSource(repos: Map<unknown, unknown>) {
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
  };
  return {
    manager,
    transaction: jest.fn(
      async <R>(work: (em: typeof manager) => Promise<R>): Promise<R> =>
        work(manager),
    ),
  };
}
