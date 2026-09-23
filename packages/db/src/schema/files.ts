import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn } from "./common.js";
import { core } from "./core.js";
import { households, users } from "./identity.js";

export const files = core.table(
  "files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scope: text("scope").notNull(),
    householdId: uuid("household_id").references(() => households.id, {
      onDelete: "restrict",
    }),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    storageProvider: text("storage_provider").notNull(),
    storageKey: text("storage_key").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }).notNull(),
    sha256: text("sha256").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: createdAtColumn(),
    deletedAt: timestamp("deleted_at", {
      withTimezone: true,
      precision: 3,
    }),
  },
  (table) => [
    uniqueIndex("uq_core_files_storage").on(
      table.storageProvider,
      table.storageKey,
    ),
    unique("uq_core_files_household_id_id").on(
      table.householdId,
      table.id,
    ),
    index("ix_core_files_household").on(table.householdId),
    check(
      "ck_core_files_scope",
      sql`${table.scope} in ('household', 'user', 'system')`,
    ),
    check(
      "ck_core_files_status",
      sql`${table.status} in ('active', 'quarantined', 'deleted')`,
    ),
    check("ck_core_files_size", sql`${table.sizeBytes} >= 0`),
  ],
);
