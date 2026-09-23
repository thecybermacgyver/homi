import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { core } from "./core.js";
import { users } from "./identity.js";
import { modules } from "./modules.js";

export const backups = core.table(
  "backups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    backupType: text("backup_type").notNull(),
    appVersion: text("app_version").notNull(),
    databaseVersion: text("database_version").notNull(),
    storageLocation: text("storage_location").notNull(),
    checksum: text("checksum").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }),
    status: text("status").notNull().default("pending"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      precision: 3,
    }),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => [
    index("ix_core_backups_status_created").on(table.status, table.createdAt),
    check(
      "ck_core_backups_status",
      sql`${table.status} in ('pending', 'running', 'complete', 'failed')`,
    ),
    check(
      "ck_core_backups_size",
      sql`${table.sizeBytes} is null or ${table.sizeBytes} >= 0`,
    ),
  ],
);

export const updateRuns = core.table(
  "update_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    componentType: text("component_type").notNull(),
    moduleId: uuid("module_id").references(() => modules.id, {
      onDelete: "restrict",
    }),
    fromVersion: text("from_version"),
    toVersion: text("to_version").notNull(),
    backupId: uuid("backup_id").references(() => backups.id, {
      onDelete: "restrict",
    }),
    status: text("status").notNull().default("pending"),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      precision: 3,
    }),
    rollbackOfUpdateId: uuid("rollback_of_update_id"),
    errorDetails: text("error_details"),
  },
  (table) => [
    index("ix_core_update_runs_status_started").on(
      table.status,
      table.startedAt,
    ),
    check(
      "ck_core_update_runs_component_type",
      sql`${table.componentType} in ('core', 'module')`,
    ),
    check(
      "ck_core_update_runs_status",
      sql`${table.status} in ('pending', 'running', 'complete', 'failed', 'rolled_back')`,
    ),
  ],
);
