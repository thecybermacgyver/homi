import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export interface HomiDatabase {
  db: NodePgDatabase;
  check(): Promise<void>;
  close(): Promise<void>;
}

export function createHomiDatabase(connectionString: string): HomiDatabase {
  if (!connectionString.trim()) {
    throw new Error("HOMI_DATABASE_URL must not be empty.");
  }

  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  const db = drizzle({ client: pool });

  return {
    db,

    async check() {
      await db.execute(sql`select 1`);
    },

    async close() {
      await pool.end();
    },
  };
}
