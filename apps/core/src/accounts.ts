import { sql } from "drizzle-orm";
import type { HomiDatabase } from "@homi/db";
import type { HomiRequestContext } from "@homi/module-sdk";
import {
  HOMI_MAX_PASSWORD_LENGTH,
  HOMI_MIN_PASSWORD_LENGTH,
  type HomiAuthRuntime,
} from "./auth.js";

export interface HomiAccountSummary {
  readonly displayName: string;
  readonly email: string | null;
  readonly passwordChangeRequired: boolean;
}

export interface HomiHouseholdMember {
  readonly membershipId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly administrator: boolean;
  readonly self: boolean;
  readonly passwordChangeRequired: boolean;
}

export interface HomiAccountService {
  get(authSubject: string): Promise<HomiAccountSummary>;
  changePassword(
    headers: Headers,
    authSubject: string,
    input: { currentPassword: string; newPassword: string },
  ): Promise<{ readonly setCookies: readonly string[] }>;
  listMembers(
    context: HomiRequestContext,
  ): Promise<readonly HomiHouseholdMember[]>;
  resetMemberPassword(
    context: HomiRequestContext,
    membershipId: string,
    temporaryPassword: string,
  ): Promise<void>;
  addMember(
    context: HomiRequestContext,
    input: { displayName: string; email: string; temporaryPassword: string },
  ): Promise<HomiAddedMember>;
}

export interface HomiAddedMember {
  readonly membershipId: string;
  readonly displayName: string;
  readonly email: string;
}

export class HomiAccountError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HomiAccountError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Server-side password checks bypass Better Auth's HTTP rate limiter, so
// wrong current-password attempts are limited per account here.
const FAILED_ATTEMPT_LIMIT = 5;
const FAILED_ATTEMPT_WINDOW_MS = 15 * 60_000;

function requirePasswordLength(password: string, field: string): void {
  if (
    password.length < HOMI_MIN_PASSWORD_LENGTH ||
    password.length > HOMI_MAX_PASSWORD_LENGTH
  ) {
    throw new HomiAccountError(
      400,
      "PASSWORD_LENGTH_INVALID",
      `${field} must be ${HOMI_MIN_PASSWORD_LENGTH} to ${HOMI_MAX_PASSWORD_LENGTH} characters.`,
    );
  }
}

export function createHomiAccountService(
  database: HomiDatabase["db"],
  auth: HomiAuthRuntime,
  now: () => number = Date.now,
): HomiAccountService {
  const failures = new Map<string, number[]>();

  function recentFailures(authSubject: string): number[] {
    const cutoff = now() - FAILED_ATTEMPT_WINDOW_MS;
    const recent = (failures.get(authSubject) ?? []).filter((at) => at > cutoff);
    failures.set(authSubject, recent);
    return recent;
  }

  async function activeUser(authSubject: string) {
    const result = await database.execute(sql`
      SELECT id::text AS id, display_name AS "displayName",
        password_change_required AS "passwordChangeRequired"
      FROM core.users
      WHERE auth_subject = ${authSubject} AND status = 'active' AND deleted_at IS NULL
      LIMIT 1
    `);
    const row = result.rows[0] as
      | { id: string; displayName: string; passwordChangeRequired: boolean }
      | undefined;
    if (!row) {
      throw new HomiAccountError(403, "ACCOUNT_UNAVAILABLE", "This account is not active in Homi.");
    }
    return row;
  }

  const service: HomiAccountService = {
    async get(authSubject) {
      const user = await activeUser(authSubject);
      return Object.freeze({
        displayName: user.displayName,
        email: await auth.getEmail(authSubject),
        passwordChangeRequired: user.passwordChangeRequired,
      });
    },

    async changePassword(headers, authSubject, input) {
      const user = await activeUser(authSubject);
      requirePasswordLength(input.newPassword, "The new password");
      if (input.newPassword === input.currentPassword) {
        throw new HomiAccountError(400, "PASSWORD_UNCHANGED", "Choose a password different from the current one.");
      }
      if (recentFailures(authSubject).length >= FAILED_ATTEMPT_LIMIT) {
        throw new HomiAccountError(429, "PASSWORD_ATTEMPTS_EXCEEDED", "Too many incorrect attempts. Try again in 15 minutes.");
      }
      const result = await auth.changePassword(headers, input.currentPassword, input.newPassword);
      if (result.status !== 200) {
        if (result.code === "INVALID_PASSWORD") {
          failures.set(authSubject, [...recentFailures(authSubject), now()]);
          throw new HomiAccountError(400, "CURRENT_PASSWORD_INCORRECT", "The current password is incorrect.");
        }
        if (result.code === "PASSWORD_TOO_SHORT" || result.code === "PASSWORD_TOO_LONG") {
          throw new HomiAccountError(
            400,
            "PASSWORD_LENGTH_INVALID",
            `The new password must be ${HOMI_MIN_PASSWORD_LENGTH} to ${HOMI_MAX_PASSWORD_LENGTH} characters.`,
          );
        }
        throw new HomiAccountError(
          result.status >= 500 ? 502 : 400,
          result.code ?? "PASSWORD_CHANGE_FAILED",
          "The password could not be changed.",
        );
      }
      failures.delete(authSubject);
      await database.transaction(async (tx) => {
        await tx.execute(sql`
          UPDATE core.users
          SET password_change_required = false, revision = revision + 1, updated_at = now()
          WHERE id = CAST(${user.id} AS uuid)
        `);
        await tx.execute(sql`
          INSERT INTO core.audit_log (actor_user_id, action, target_type, target_id, source_module_key, metadata)
          VALUES (
            CAST(${user.id} AS uuid), 'core.account.password.changed', 'user', CAST(${user.id} AS uuid), 'core',
            CAST(${JSON.stringify({ requiredByAdministrator: user.passwordChangeRequired })} AS jsonb)
          )
        `);
      });
      return Object.freeze({ setCookies: result.setCookies });
    },

    async listMembers(context) {
      const result = await database.execute(sql`
        SELECT m.id::text AS "membershipId", u.display_name AS "displayName",
          u.auth_subject AS "authSubject", u.id::text AS "userId",
          u.password_change_required AS "passwordChangeRequired",
          EXISTS (
            SELECT 1 FROM core.membership_roles mr
            JOIN core.roles r ON r.id = mr.role_id
            JOIN core.role_permissions rp ON rp.role_id = r.id
            WHERE mr.membership_id = m.id
              AND rp.permission_key = 'core.household.admin'
              AND (r.household_id IS NULL OR r.household_id = m.household_id)
          ) AS administrator
        FROM core.household_memberships m
        JOIN core.users u ON u.id = m.user_id
        WHERE m.household_id = CAST(${context.householdId} AS uuid)
          AND m.status = 'active' AND m.ended_at IS NULL
          AND u.status = 'active' AND u.deleted_at IS NULL
        ORDER BY lower(u.display_name), m.id
      `);
      const rows = result.rows as unknown as {
        membershipId: string; displayName: string; authSubject: string;
        userId: string; passwordChangeRequired: boolean; administrator: boolean;
      }[];
      return Object.freeze(await Promise.all(rows.map(async (row) => Object.freeze({
        membershipId: row.membershipId,
        displayName: row.displayName,
        email: await auth.getEmail(row.authSubject),
        administrator: row.administrator,
        self: row.userId === context.userId,
        passwordChangeRequired: row.passwordChangeRequired,
      }))));
    },

    // An administrator adds a member directly: Homi creates the sign-in account
    // with the temporary password the administrator hands over, links it to the
    // household, and requires the member to choose their own password at first
    // sign-in. No email is sent, so Homi needs no mail server.
    async addMember(context, input) {
      const displayName = input.displayName.trim();
      const email = input.email.trim().toLowerCase();
      if (displayName.length < 1 || displayName.length > 80) {
        throw new HomiAccountError(400, "MEMBER_NAME_INVALID", "Enter the member's name (up to 80 characters).");
      }
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new HomiAccountError(400, "MEMBER_EMAIL_INVALID", "Enter a valid email address.");
      }
      requirePasswordLength(input.temporaryPassword, "The temporary password");
      if (await auth.emailInUse(email)) {
        throw new HomiAccountError(409, "MEMBER_EMAIL_IN_USE", "An account with that email address already exists.");
      }
      const authSubject = await auth.createUser({
        email,
        name: displayName,
        password: input.temporaryPassword,
      });
      try {
        const membershipId = await database.transaction(async (tx) => {
          const user = await tx.execute(sql`
            INSERT INTO core.users (auth_subject, display_name, preferred_locale, time_zone, password_change_required)
            VALUES (${authSubject}, ${displayName}, ${context.locale}, ${context.timeZone}, true)
            RETURNING id::text AS id
          `);
          const userId = (user.rows[0] as { id: string }).id;
          const membership = await tx.execute(sql`
            INSERT INTO core.household_memberships (household_id, user_id, status)
            VALUES (CAST(${context.householdId} AS uuid), CAST(${userId} AS uuid), 'active')
            RETURNING id::text AS id
          `);
          const created = (membership.rows[0] as { id: string }).id;
          await tx.execute(sql`
            INSERT INTO core.household_people (household_id, linked_membership_id, display_name, status)
            VALUES (CAST(${context.householdId} AS uuid), CAST(${created} AS uuid), ${displayName}, 'active')
          `);
          await tx.execute(sql`
            INSERT INTO core.audit_log (household_id, actor_user_id, action, target_type, target_id, source_module_key, request_id, metadata)
            VALUES (
              CAST(${context.householdId} AS uuid), CAST(${context.userId} AS uuid),
              'core.member.added', 'user', CAST(${userId} AS uuid), 'core',
              ${context.requestId}, CAST('{}' AS jsonb)
            )
          `);
          return created;
        });
        return Object.freeze({ membershipId, displayName, email });
      } catch (error) {
        // Never leave a sign-in account that belongs to no household.
        await auth.deleteUser(authSubject).catch(() => undefined);
        throw error;
      }
    },

    async resetMemberPassword(context, membershipId, temporaryPassword) {
      if (!UUID.test(membershipId)) {
        throw new HomiAccountError(400, "MEMBERSHIP_ID_INVALID", "membershipId must be a UUID.");
      }
      requirePasswordLength(temporaryPassword, "The temporary password");
      const result = await database.execute(sql`
        SELECT u.id::text AS "userId", u.auth_subject AS "authSubject"
        FROM core.household_memberships m
        JOIN core.users u ON u.id = m.user_id
        WHERE m.id = CAST(${membershipId} AS uuid)
          AND m.household_id = CAST(${context.householdId} AS uuid)
          AND m.status = 'active' AND m.ended_at IS NULL
          AND u.status = 'active' AND u.deleted_at IS NULL
        LIMIT 1
      `);
      const target = result.rows[0] as { userId: string; authSubject: string } | undefined;
      if (!target) {
        throw new HomiAccountError(404, "MEMBER_NOT_FOUND", "That member is not in this household.");
      }
      if (target.userId === context.userId) {
        throw new HomiAccountError(400, "OWN_PASSWORD_RESET_NOT_ALLOWED", "Use Change password for your own account.");
      }
      // Store the new password (ending every session) before requiring a
      // change, so a failed reset never leaves a member forced to replace a
      // password they were not given.
      await auth.setPassword(target.authSubject, temporaryPassword);
      await database.transaction(async (tx) => {
        await tx.execute(sql`
          UPDATE core.users
          SET password_change_required = true, revision = revision + 1, updated_at = now()
          WHERE id = CAST(${target.userId} AS uuid)
        `);
        await tx.execute(sql`
          INSERT INTO core.audit_log (household_id, actor_user_id, action, target_type, target_id, source_module_key, request_id, metadata)
          VALUES (
            CAST(${context.householdId} AS uuid), CAST(${context.userId} AS uuid),
            'core.member.password.reset', 'user', CAST(${target.userId} AS uuid), 'core',
            ${context.requestId}, CAST('{}' AS jsonb)
          )
        `);
      });
    },
  };
  return Object.freeze(service);
}
