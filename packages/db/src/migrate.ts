import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

const connectionString = process.env.HOMI_MIGRATOR_DATABASE_URL;

if (!connectionString) {
  throw new Error("HOMI_MIGRATOR_DATABASE_URL is required.");
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, "../migrations/core");

const client = new Client({
  connectionString,
  connectionTimeoutMillis: 5_000,
});

await client.connect();

try {
  await client.query("SET ROLE homi_owner");

  const db = drizzle({ client });

  await migrate(db, {
    migrationsFolder,
    migrationsTable: "__homi_core_migrations",
    migrationsSchema: "public",
  });

  await client.query("RESET ROLE");

  console.log("Homi Core migrations applied successfully.");
} finally {
  await client.end();
}
