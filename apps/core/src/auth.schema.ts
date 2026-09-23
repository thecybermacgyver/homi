import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const secret = process.env.HOMI_AUTH_SCHEMA_SECRET;

if (!secret) {
  throw new Error("HOMI_AUTH_SCHEMA_SECRET is required for schema generation.");
}

/*
 * Better Auth's Drizzle generator does not need a live database connection.
 * This Pool exists only so the adapter can be constructed while the CLI
 * derives the schema. Do not reuse this file as Homi's runtime auth config.
 */
const pool = new Pool({
  connectionString:
    "postgresql://schema_generation:unused@127.0.0.1:1/homi",
});

const db = drizzle({ client: pool });

export const auth = betterAuth({
  secret,
  baseURL: "http://127.0.0.1",
  database: drizzleAdapter(db, {
    provider: "pg",
    schemaName: "auth",
  }),
  emailAndPassword: {
    enabled: true,
  },
  advanced: {
    database: {
      generateId: "uuid",
    },
  },
  telemetry: {
    enabled: false,
  },
});
