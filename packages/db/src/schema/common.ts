import { sql } from "drizzle-orm";
import { bigint, timestamp } from "drizzle-orm/pg-core";

export const revisionColumn = () =>
  bigint("revision", { mode: "bigint" }).notNull().default(sql`1`);

export const createdAtColumn = () =>
  timestamp("created_at", { withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow();

export const updatedAtColumn = () =>
  timestamp("updated_at", { withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow();

export const deletedAtColumn = () =>
  timestamp("deleted_at", { withTimezone: true, precision: 3 });

