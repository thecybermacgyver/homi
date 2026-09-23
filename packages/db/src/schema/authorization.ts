import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "./common.js";
import { core } from "./core.js";
import {
  householdMemberships,
  households,
  users,
} from "./identity.js";

export const permissions = core.table("permissions", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
  createdAt: createdAtColumn(),
});

export const roles = core.table(
  "roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id").references(() => households.id, {
      onDelete: "restrict",
    }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("uq_core_roles_system_key")
      .on(table.key)
      .where(sql`${table.householdId} is null`),
    uniqueIndex("uq_core_roles_household_key")
      .on(table.householdId, table.key)
      .where(sql`${table.householdId} is not null`),
  ],
);

export const rolePermissions = core.table(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({
      name: "pk_core_role_permissions",
      columns: [table.roleId, table.permissionKey],
    }),
  ],
);

export const membershipRoles = core.table(
  "membership_roles",
  {
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => householdMemberships.id, { onDelete: "restrict" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    grantedByUserId: uuid("granted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    grantedAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({
      name: "pk_core_membership_roles",
      columns: [table.membershipId, table.roleId],
    }),
  ],
);
