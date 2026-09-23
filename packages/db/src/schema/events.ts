import { sql } from "drizzle-orm";
import {
  bigserial,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { core } from "./core.js";
import { households, users } from "./identity.js";
import { clients } from "./sync.js";

export const eventOutbox = core.table(
  "event_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id").references(() => households.id, {
      onDelete: "restrict",
    }),
    sourceModuleKey: text("source_module_key").notNull(),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type"),
    aggregateId: uuid("aggregate_id"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    availableAt: timestamp("available_at", {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", {
      withTimezone: true,
      precision: 3,
    }),
    attemptCount: integer("attempt_count").notNull().default(0),
  },
  (table) => [
    index("ix_core_event_outbox_pending")
      .on(table.availableAt)
      .where(sql`${table.publishedAt} is null`),
  ],
);

export const auditLog = core.table(
  "audit_log",
  {
    sequence: bigserial("sequence", { mode: "bigint" }).primaryKey(),
    householdId: uuid("household_id").references(() => households.id, {
      onDelete: "restrict",
    }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    actorClientId: uuid("actor_client_id").references(() => clients.id, {
      onDelete: "restrict",
    }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    sourceModuleKey: text("source_module_key").notNull().default("core"),
    requestId: text("request_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ix_core_audit_log_household_sequence").on(
      table.householdId,
      table.sequence,
    ),
    index("ix_core_audit_log_actor").on(table.actorUserId, table.createdAt),
  ],
);
