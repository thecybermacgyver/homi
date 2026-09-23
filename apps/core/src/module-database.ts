import type { HomiDatabase } from "@homi/db";
import type {
  HomiModuleDatabase,
} from "@homi/module-sdk";

export interface HomiModuleSqlQueryResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number | null;
}

export interface HomiModuleSqlQueryable {
  query(
    text: string,
    params?: readonly unknown[],
  ): Promise<HomiModuleSqlQueryResult>;
}

export interface HomiModuleSqlClient
  extends HomiModuleSqlQueryable {
  release(): void;
}

export interface HomiModuleSqlPool
  extends HomiModuleSqlQueryable {
  connect(): Promise<HomiModuleSqlClient>;
}

export function getHomiModuleSqlPool(
  database: HomiDatabase["db"],
): HomiModuleSqlPool {
  return (
    database as unknown as {
      $client: HomiModuleSqlPool;
    }
  ).$client;
}

function wrap(
  queryable: HomiModuleSqlQueryable,
  pool: HomiModuleSqlPool | null,
): HomiModuleDatabase {
  return Object.freeze({
    async query<Row extends Record<string, unknown>>(
      text: string,
      params: readonly unknown[] = [],
    ) {
      if (!text.trim()) {
        throw new Error(
          "Module database query text must not be empty.",
        );
      }

      const result = await queryable.query(
        text,
        [...params],
      );

      return Object.freeze({
        rows: Object.freeze(
          [...result.rows] as readonly Row[],
        ),
        rowCount: result.rowCount ?? result.rows.length,
      });
    },

    async transaction<T>(
      work: (database: HomiModuleDatabase) => Promise<T>,
    ): Promise<T> {
      if (!pool) {
        throw new Error(
          "Nested module database transactions are not supported.",
        );
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await work(
          wrap(client, null),
        );
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  });
}

export function createHomiModuleDatabase(
  database: HomiDatabase["db"],
): HomiModuleDatabase {
  const pool = getHomiModuleSqlPool(database);
  return wrap(pool, pool);
}

export function createTransactionalHomiModuleDatabase(
  client: HomiModuleSqlQueryable,
): HomiModuleDatabase {
  return wrap(client, null);
}
