import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  createdAtColumn,
  deletedAtColumn,
  revisionColumn,
  updatedAtColumn,
} from "./common.js";
import { core } from "./core.js";

export const users = core.table(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authSubject: text("auth_subject").notNull(),
    displayName: text("display_name").notNull(),
    preferredLocale: text("preferred_locale").notNull().default("en-CA"),
    timeZone: text("time_zone"),
    status: text("status").notNull().default("active"),
    revision: revisionColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: deletedAtColumn(),
  },
  (table) => [
    uniqueIndex("uq_core_users_auth_subject").on(table.authSubject),
    check(
      "ck_core_users_status",
      sql`${table.status} in ('active', 'suspended', 'disabled')`,
    ),
    check("ck_core_users_revision", sql`${table.revision} >= 1`),
  ],
);

export const households = core.table(
  "households",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    defaultLocale: text("default_locale").notNull().default("en-CA"),
    timeZone: text("time_zone").notNull().default("UTC"),
    status: text("status").notNull().default("active"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    revision: revisionColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: deletedAtColumn(),
  },
  (table) => [
    check(
      "ck_core_households_status",
      sql`${table.status} in ('active', 'suspended', 'deleting')`,
    ),
    check("ck_core_households_revision", sql`${table.revision} >= 1`),
  ],
);

export const householdMemberships = core.table(
  "household_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true, precision: 3 }),
    revision: revisionColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("uq_core_memberships_active_user_household")
      .on(table.householdId, table.userId)
      .where(sql`${table.endedAt} is null`),
    unique("uq_core_memberships_household_id_id").on(
      table.householdId,
      table.id,
    ),
    index("ix_core_memberships_user").on(table.userId),
    check(
      "ck_core_memberships_status",
      sql`${table.status} in ('active', 'suspended', 'ended')`,
    ),
    check(
      "ck_core_memberships_revision",
      sql`${table.revision} >= 1`,
    ),
  ],
);

export const householdPeople = core.table(
  "household_people",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "restrict" }),
    linkedMembershipId: uuid("linked_membership_id"),
    displayName: text("display_name").notNull(),
    avatarFileId: uuid("avatar_file_id"),
    status: text("status").notNull().default("active"),
    revision: revisionColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("uq_core_household_people_membership")
      .on(table.linkedMembershipId)
      .where(sql`${table.linkedMembershipId} is not null`),
    unique("uq_core_household_people_household_id_id").on(
      table.householdId,
      table.id,
    ),
    index("ix_core_household_people_household").on(table.householdId),
    foreignKey({
      name: "fk_core_household_people_membership_household",
      columns: [table.householdId, table.linkedMembershipId],
      foreignColumns: [
        householdMemberships.householdId,
        householdMemberships.id,
      ],
    }).onDelete("restrict"),
    check(
      "ck_core_household_people_status",
      sql`${table.status} in ('active', 'inactive')`,
    ),
    check(
      "ck_core_household_people_revision",
      sql`${table.revision} >= 1`,
    ),
  ],
);

export const householdInvitations = core.table(
  "household_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "restrict" }),
    invitedEmail: text("invited_email").notNull(),
    tokenHash: text("token_hash").notNull(),
    invitedByUserId: uuid("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 3 })
      .notNull(),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    acceptedAt: timestamp("accepted_at", {
      withTimezone: true,
      precision: 3,
    }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("uq_core_household_invitations_token_hash").on(
      table.tokenHash,
    ),
    index("ix_core_household_invitations_household_status").on(
      table.householdId,
      table.status,
      table.expiresAt,
    ),
    check(
      "ck_core_household_invitations_status",
      sql`${table.status} in ('pending', 'accepted', 'revoked', 'expired')`,
    ),
  ],
);
