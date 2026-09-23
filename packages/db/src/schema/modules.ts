import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  createdAtColumn,
  revisionColumn,
  updatedAtColumn,
} from "./common.js";
import { core } from "./core.js";
import {
  householdMemberships,
  households,
  users,
} from "./identity.js";

export const modules = core.table(
  "modules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    moduleKey: text("module_key").notNull(),
    name: text("name").notNull(),
    publisher: text("publisher").notNull(),
    state: text("state").notNull().default("installed"),
    currentVersion: text("current_version").notNull(),
    manifest: jsonb("manifest").notNull(),
    installedAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("uq_core_modules_module_key").on(table.moduleKey),
    check(
      "ck_core_modules_state",
      sql`${table.state} in ('installed', 'updating', 'disabled', 'failed')`,
    ),
  ],
);

export const moduleVersions = core.table(
  "module_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "restrict" }),
    version: text("version").notNull(),
    packageDigest: text("package_digest").notNull(),
    manifest: jsonb("manifest").notNull(),
    migrationState: text("migration_state").notNull().default("applied"),
    installedAt: createdAtColumn(),
    retiredAt: timestamp("retired_at", {
      withTimezone: true,
      precision: 3,
    }),
  },
  (table) => [
    uniqueIndex("uq_core_module_versions_module_version").on(
      table.moduleId,
      table.version,
    ),
    check(
      "ck_core_module_versions_migration_state",
      sql`${table.migrationState} in ('pending', 'applied', 'failed', 'rolled_back')`,
    ),
  ],
);

export const householdModules = core.table(
  "household_modules",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "restrict" }),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "restrict" }),
    enabled: boolean("enabled").notNull().default(true),
    enabledAt: timestamp("enabled_at", {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    disabledAt: timestamp("disabled_at", {
      withTimezone: true,
      precision: 3,
    }),
    enabledByUserId: uuid("enabled_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    revision: revisionColumn(),
  },
  (table) => [
    primaryKey({
      name: "pk_core_household_modules",
      columns: [table.householdId, table.moduleId],
    }),
    check(
      "ck_core_household_modules_revision",
      sql`${table.revision} >= 1`,
    ),
  ],
);
export const householdMemberModulePreferences = core.table(
  "household_member_module_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id").notNull(),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "restrict" }),
    surfaceId: text("surface_id").notNull(),
    visible: boolean("visible").notNull().default(true),
    displayOrder: integer("display_order").notNull(),
    revision: revisionColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("uq_core_member_module_preferences")
      .on(
        table.householdId,
        table.membershipId,
        table.moduleId,
        table.surfaceId,
      ),
    index("ix_core_member_module_preferences_order")
      .on(table.householdId, table.membershipId, table.displayOrder),
    foreignKey({
      name: "fk_core_member_module_preferences_membership_household",
      columns: [table.householdId, table.membershipId],
      foreignColumns: [
        householdMemberships.householdId,
        householdMemberships.id,
      ],
    }).onDelete("restrict"),
    check(
      "ck_core_member_module_preferences_display_order",
      sql`${table.displayOrder} >= 0`,
    ),
    check(
      "ck_core_member_module_preferences_revision",
      sql`${table.revision} >= 1`,
    ),
  ],
);


export const moduleSecrets = core.table(
  "module_secrets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "restrict" }),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "restrict" }),
    secretKey: text("secret_key").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    revision: revisionColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("uq_core_module_secrets_scope_key").on(
      table.householdId,
      table.moduleId,
      table.secretKey,
    ),
    check(
      "ck_core_module_secrets_revision",
      sql`${table.revision} >= 1`,
    ),
  ],
);

export const moduleJobs = core.table(
  "module_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "restrict" }),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "restrict" }),
    jobType: text("job_type").notNull(),
    runAt: timestamp("run_at", {
      withTimezone: true,
      precision: 3,
    }).notNull(),
    payload: jsonb("payload").notNull().default({}),
    context: jsonb("context").notNull(),
    dedupeKey: text("dedupe_key"),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    lockedAt: timestamp("locked_at", {
      withTimezone: true,
      precision: 3,
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      precision: 3,
    }),
  },
  (table) => [
    index("ix_core_module_jobs_due").on(
      table.runAt,
      table.createdAt,
    ),
    index("ix_core_module_jobs_scope").on(
      table.householdId,
      table.moduleId,
      table.status,
      table.runAt,
    ),
    check(
      "ck_core_module_jobs_status",
      sql`${table.status} in ('pending', 'running', 'complete', 'failed', 'cancelled')`,
    ),
    check(
      "ck_core_module_jobs_attempt_count",
      sql`${table.attemptCount} >= 0`,
    ),
  ],
);
