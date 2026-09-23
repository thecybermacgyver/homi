import {
  index,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { revisionColumn } from "./common.js";
import { core } from "./core.js";
import { households, users } from "./identity.js";
import { clients } from "./sync.js";

export const notifications = core.table(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    sourceModuleKey: text("source_module_key").notNull(),
    notificationType: text("notification_type").notNull(),
    titleKey: text("title_key").notNull(),
    bodyKey: text("body_key").notNull(),
    arguments: jsonb("arguments").notNull().default({}),
    data: jsonb("data").notNull().default({}),
    revision: revisionColumn(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true, precision: 3 }),
    dismissedAt: timestamp("dismissed_at", {
      withTimezone: true,
      precision: 3,
    }),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      precision: 3,
    }),
  },
  (table) => [
    index("ix_core_notifications_user_created").on(
      table.userId,
      table.createdAt,
    ),
    index("ix_core_notifications_user_read").on(
      table.userId,
      table.readAt,
    ),
  ],
);

export const pushSubscriptions = core.table(
  "push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "restrict",
    }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", {
      withTimezone: true,
      precision: 3,
    }),
    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      precision: 3,
    }),
  },
  (table) => [
    uniqueIndex("uq_core_push_subscriptions_endpoint").on(table.endpoint),
    index("ix_core_push_subscriptions_user").on(table.userId),
  ],
);
