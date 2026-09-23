import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { core } from "./core.js";
import { users } from "./identity.js";

export const localizationSources = core.table(
  "localization_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    namespace: text("namespace").notNull(),
    messageKey: text("message_key").notNull(),
    sourceLocale: text("source_locale").notNull(),
    sourceText: text("source_text").notNull(),
    sourceHash: text("source_hash").notNull(),
    sourceVersion: integer("source_version").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_core_localization_sources_version").on(
      table.namespace,
      table.messageKey,
      table.sourceLocale,
      table.sourceVersion,
    ),
    index("ix_core_localization_sources_lookup").on(
      table.namespace,
      table.messageKey,
      table.sourceLocale,
    ),
    check(
      "ck_core_localization_sources_version",
      sql`${table.sourceVersion} >= 1`,
    ),
  ],
);

export const localizationTranslations = core.table(
  "localization_translations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => localizationSources.id, { onDelete: "restrict" }),
    locale: text("locale").notNull(),
    translatedText: text("translated_text").notNull(),
    translationVersion: integer("translation_version").notNull(),
    providerKey: text("provider_key"),
    origin: text("origin").notNull(),
    status: text("status").notNull().default("active"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_core_localization_translations_version").on(
      table.sourceId,
      table.locale,
      table.translationVersion,
    ),
    check(
      "ck_core_localization_translations_origin",
      sql`${table.origin} in ('provider', 'human')`,
    ),
    check(
      "ck_core_localization_translations_status",
      sql`${table.status} in ('active', 'stale', 'rejected')`,
    ),
    check(
      "ck_core_localization_translations_version",
      sql`${table.translationVersion} >= 1`,
    ),
  ],
);
