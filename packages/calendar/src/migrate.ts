import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const connectionString = process.env.HOMI_MIGRATOR_DATABASE_URL;
if (!connectionString) {
  throw new Error("HOMI_MIGRATOR_DATABASE_URL is required.");
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, "../migrations");
const client = new Client({
  connectionString,
  connectionTimeoutMillis: 5_000,
});

await client.connect();

try {
  await client.query("SET ROLE homi_owner");
  await client.query(
    "CREATE SCHEMA IF NOT EXISTS mod_calendar AUTHORIZATION homi_owner",
  );
  await client.query(`
    CREATE TABLE IF NOT EXISTS mod_calendar.schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz(3) NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsFolder))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const existing = await client.query(
      "SELECT 1 FROM mod_calendar.schema_migrations WHERE id = $1 LIMIT 1",
      [file],
    );
    if (existing.rowCount) continue;

    const sqlText = await readFile(
      resolve(migrationsFolder, file),
      "utf8",
    );

    await client.query("BEGIN");
    try {
      await client.query(sqlText);
      await client.query(
        "INSERT INTO mod_calendar.schema_migrations (id) VALUES ($1)",
        [file],
      );
      await client.query("COMMIT");
      console.log(`Applied Calendar migration ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  await client.query("RESET ROLE");
  console.log("Homi Calendar migrations applied successfully.");
} finally {
  await client.end();
}
