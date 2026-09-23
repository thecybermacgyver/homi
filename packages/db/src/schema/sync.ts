import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn } from "./common.js";
import { core } from "./core.js";
import { households, users } from "./identity.js";

export const clients = core.table(
  "clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    clientInstanceId: uuid("client_instance_id").notNull(),
    label: text("label"),
    platform: text("platform"),
    appVersion: text("app_version"),
    createdAt: createdAtColumn(),
    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
      precision: 3,
    }),
    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      precision: 3,
    }),
  },
  (table) => [
    uniqueIndex("uq_core_clients_user_instance").on(
      table.userId,
      table.clientInstanceId,
    ),
  ],
);

export const changeLog = core.table(
  "change_log",
  {
    sequence: bigserial("sequence", { mode: "bigint" }).primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "restrict" }),
    moduleKey: text("module_key").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    operation: text("operation").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    changedByUserId: uuid("changed_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    recipientUserId: uuid("recipient_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "restrict",
    }),
    changedAt: timestamp("changed_at", {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ix_core_change_log_household_sequence").on(
      table.householdId,
      table.sequence,
    ),
    index("ix_core_change_log_entity").on(
      table.householdId,
      table.moduleKey,
      table.entityType,
      table.entityId,
    ),
    index("ix_core_change_log_recipient_sequence").on(
      table.householdId,
      table.recipientUserId,
      table.sequence,
    ),
    check(
      "ck_core_change_log_operation",
      sql`${table.operation} in ('create', 'update', 'delete')`,
    ),
    check("ck_core_change_log_revision", sql`${table.revision} >= 1`),
  ],
);

export const syncCursors = core.table(
  "sync_cursors",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "restrict" }),
    lastChangeSequence: bigint("last_change_sequence", {
      mode: "bigint",
    })
      .notNull()
      .default(sql`0`),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "pk_core_sync_cursors",
      columns: [table.clientId, table.householdId],
    }),
    check(
      "ck_core_sync_cursors_sequence",
      sql`${table.lastChangeSequence} >= 0`,
    ),
  ],
);

export const syncMutations = core.table(
  "sync_mutations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "restrict" }),
    clientMutationId: uuid("client_mutation_id").notNull(),
    moduleKey: text("module_key").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    baseRevision: bigint("base_revision", { mode: "bigint" }),
    requestHash: text("request_hash"),
    resultPayload: jsonb("result_payload"),
    status: text("status").notNull().default("received"),
    serverRevision: bigint("server_revision", { mode: "bigint" }),
    changeSequence: bigint("change_sequence", { mode: "bigint" }),
    receivedAt: timestamp("received_at", {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    appliedAt: timestamp("applied_at", {
      withTimezone: true,
      precision: 3,
    }),
    errorCode: text("error_code"),
  },
  (table) => [
    uniqueIndex("uq_core_sync_mutations_client_mutation").on(
      table.clientId,
      table.clientMutationId,
    ),
    index("ix_core_sync_mutations_household").on(table.householdId),
    check(
      "ck_core_sync_mutations_status",
      sql`${table.status} in ('received', 'applied', 'conflict', 'rejected')`,
    ),
    check(
      "ck_core_sync_mutations_base_revision",
      sql`${table.baseRevision} is null or ${table.baseRevision} >= 0`,
    ),
  ],
);
