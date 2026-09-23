import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations/core",
  migrations: {
    table: "__homi_core_migrations",
    schema: "public",
  },
  strict: true,
  verbose: true,
});
