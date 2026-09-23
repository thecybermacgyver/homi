import {
  householdMemberships,
  householdPeople,
  households,
  users,
  type HomiDatabase,
} from "@homi/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { HomiRequestContext } from "./context.js";

export interface HomiHouseholdSettings {
  id: string;
  name: string;
  defaultLocale: string;
  timeZone: string;
  status: string;
  revision: bigint;
}

export interface UpdateHomiHouseholdSettingsInput {
  baseRevision: bigint;
  name?: string;
  defaultLocale?: string;
  timeZone?: string;
}

export interface HomiHouseholdDiscovery {
  userId: string;
  households: Array<{ householdId: string; name: string }>;
}

export interface HomiHouseholdService {
  discover(authSubject: string): Promise<HomiHouseholdDiscovery>;

  getSettings(
    context: HomiRequestContext,
  ): Promise<HomiHouseholdSettings>;

  updateSettings(
    context: HomiRequestContext,
    input: UpdateHomiHouseholdSettingsInput,
  ): Promise<HomiHouseholdSettings>;
}

export class HomiHouseholdError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HomiHouseholdError";
  }
}

interface LockedHouseholdRow {
  id: string;
  name: string;
  defaultLocale: string;
  timeZone: string;
  status: string;
  revision: string;
}

interface UpdatedHouseholdRow extends LockedHouseholdRow {}

export function createHomiHouseholdService(
  database: HomiDatabase["db"],
): HomiHouseholdService {
  return {
    async discover(authSubject) {
      const [user] = await database
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.authSubject, authSubject),
            eq(users.status, "active"),
            isNull(users.deletedAt),
          ),
        )
        .limit(1);

      if (!user) {
        throw new HomiHouseholdError(
          403,
          "CORE_USER_UNAVAILABLE",
          "The authenticated account is not an active Homi user.",
        );
      }

      const candidates = await database
        .selectDistinct({ householdId: households.id, name: households.name })
        .from(householdMemberships)
        .innerJoin(
          households,
          and(
            eq(households.id, householdMemberships.householdId),
            eq(households.status, "active"),
            isNull(households.deletedAt),
          ),
        )
        .innerJoin(
          householdPeople,
          and(
            eq(householdPeople.linkedMembershipId, householdMemberships.id),
            eq(householdPeople.householdId, households.id),
            eq(householdPeople.status, "active"),
          ),
        )
        .where(
          and(
            eq(householdMemberships.userId, user.id),
            eq(householdMemberships.status, "active"),
            isNull(householdMemberships.endedAt),
          ),
        )
        .orderBy(asc(households.name), asc(households.id));

      return { userId: user.id, households: candidates };
    },

    async getSettings(context) {
      const [household] = await database
        .select({
          id: households.id,
          name: households.name,
          defaultLocale: households.defaultLocale,
          timeZone: households.timeZone,
          status: households.status,
          revision: households.revision,
        })
        .from(households)
        .where(eq(households.id, context.householdId))
        .limit(1);

      if (!household) {
        throw new HomiHouseholdError(
          404,
          "HOUSEHOLD_NOT_FOUND",
          "Household not found.",
        );
      }

      return household;
    },

    async updateSettings(context, input) {
      return database.transaction(async (tx) => {
        const currentResult = await tx.execute(sql`
          SELECT
            id,
            name,
            default_locale AS "defaultLocale",
            time_zone AS "timeZone",
            status,
            revision
          FROM core.households
          WHERE id = CAST(${context.householdId} AS uuid)
            AND status = 'active'
            AND deleted_at IS NULL
          FOR UPDATE
        `);

        const current =
          currentResult.rows[0] as LockedHouseholdRow | undefined;

        if (!current) {
          throw new HomiHouseholdError(
            404,
            "HOUSEHOLD_NOT_FOUND",
            "Household not found.",
          );
        }

        const currentRevision = BigInt(current.revision);

        if (currentRevision !== input.baseRevision) {
          throw new HomiHouseholdError(
            409,
            "REVISION_CONFLICT",
            "The household settings changed since they were loaded.",
          );
        }

        const nextName = input.name ?? current.name;
        const nextLocale =
          input.defaultLocale ?? current.defaultLocale;
        const nextTimeZone = input.timeZone ?? current.timeZone;

        const updateResult = await tx.execute(sql`
          UPDATE core.households
          SET
            name = ${nextName},
            default_locale = ${nextLocale},
            time_zone = ${nextTimeZone},
            revision = revision + 1,
            updated_at = now()
          WHERE id = CAST(${context.householdId} AS uuid)
          RETURNING
            id,
            name,
            default_locale AS "defaultLocale",
            time_zone AS "timeZone",
            status,
            revision
        `);

        const updated =
          updateResult.rows[0] as UpdatedHouseholdRow | undefined;

        if (!updated) {
          throw new HomiHouseholdError(
            500,
            "HOUSEHOLD_UPDATE_FAILED",
            "The household settings could not be updated.",
          );
        }

        const auditMetadata = JSON.stringify({
          before: {
            name: current.name,
            defaultLocale: current.defaultLocale,
            timeZone: current.timeZone,
            revision: current.revision,
          },
          after: {
            name: updated.name,
            defaultLocale: updated.defaultLocale,
            timeZone: updated.timeZone,
            revision: updated.revision,
          },
        });

        await tx.execute(sql`
          INSERT INTO core.audit_log (
            household_id,
            actor_user_id,
            actor_client_id,
            action,
            target_type,
            target_id,
            source_module_key,
            request_id,
            metadata
          )
          VALUES (
            CAST(${context.householdId} AS uuid),
            CAST(${context.userId} AS uuid),
            CAST(${context.clientId ?? null} AS uuid),
            'core.household.settings.updated',
            'household',
            CAST(${context.householdId} AS uuid),
            'core',
            ${context.requestId},
            CAST(${auditMetadata} AS jsonb)
          )
        `);

        await tx.execute(sql`
          INSERT INTO core.change_log (
            household_id,
            module_key,
            entity_type,
            entity_id,
            operation,
            revision,
            changed_by_user_id,
            client_id
          )
          VALUES (
            CAST(${context.householdId} AS uuid),
            'core',
            'household',
            CAST(${context.householdId} AS uuid),
            'update',
            CAST(${updated.revision} AS bigint),
            CAST(${context.userId} AS uuid),
            CAST(${context.clientId ?? null} AS uuid)
          )
        `);

        return {
          id: updated.id,
          name: updated.name,
          defaultLocale: updated.defaultLocale,
          timeZone: updated.timeZone,
          status: updated.status,
          revision: BigInt(updated.revision),
        };
      });
    },
  };
}
