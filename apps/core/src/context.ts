import {
  clients,
  householdMemberships,
  householdPeople,
  households,
  users,
  type HomiDatabase,
} from "@homi/db";
import { and, eq, isNull } from "drizzle-orm";
import type { HomiAuthRuntime } from "./auth.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface HomiRequestContext {
  requestId: string;
  userId: string;
  householdId: string;
  membershipId: string;
  householdPersonId: string;
  clientId?: string;
  locale: string;
  timeZone: string;
}

export class HomiContextError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HomiContextError";
  }
}

export interface ResolveHomiRequestContextInput {
  requestId: string;
  headers: Headers;
  householdId: string | undefined;
  clientId?: string;
}

export interface HomiRequestContextResolver {
  resolve(
    input: ResolveHomiRequestContextInput,
  ): Promise<HomiRequestContext>;
}

export function createHomiRequestContextResolver(
  database: HomiDatabase["db"],
  auth: HomiAuthRuntime,
): HomiRequestContextResolver {
  return {
    async resolve(input) {
      const authSubject = await auth.getAuthSubject(input.headers);

      if (!authSubject) {
        throw new HomiContextError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required.",
        );
      }

      const householdId = input.householdId?.trim();

      if (!householdId) {
        throw new HomiContextError(
          400,
          "HOUSEHOLD_REQUIRED",
          "X-Homi-Household-ID is required.",
        );
      }

      if (!UUID_PATTERN.test(householdId)) {
        throw new HomiContextError(
          400,
          "INVALID_HOUSEHOLD_ID",
          "X-Homi-Household-ID must be a valid UUID.",
        );
      }

      const [row] = await database
        .select({
          userId: users.id,
          householdId: households.id,
          membershipId: householdMemberships.id,
          householdPersonId: householdPeople.id,
          preferredLocale: users.preferredLocale,
          userTimeZone: users.timeZone,
          householdLocale: households.defaultLocale,
          householdTimeZone: households.timeZone,
        })
        .from(users)
        .innerJoin(
          householdMemberships,
          and(
            eq(householdMemberships.userId, users.id),
            eq(householdMemberships.householdId, householdId),
            eq(householdMemberships.status, "active"),
            isNull(householdMemberships.endedAt),
          ),
        )
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
            eq(
              householdPeople.linkedMembershipId,
              householdMemberships.id,
            ),
            eq(householdPeople.householdId, householdId),
            eq(householdPeople.status, "active"),
          ),
        )
        .where(
          and(
            eq(users.authSubject, authSubject),
            eq(users.status, "active"),
            isNull(users.deletedAt),
          ),
        )
        .limit(1);

      if (!row) {
        throw new HomiContextError(
          403,
          "HOUSEHOLD_ACCESS_DENIED",
          "The authenticated user does not have access to this household.",
        );
      }

      let clientId: string | undefined;

      if (input.clientId !== undefined) {
        const requestedClientId = input.clientId.trim();

        if (!UUID_PATTERN.test(requestedClientId)) {
          throw new HomiContextError(
            400,
            "INVALID_CLIENT_ID",
            "X-Homi-Client-ID must be a valid UUID.",
          );
        }

        const [client] = await database
          .select({ id: clients.id })
          .from(clients)
          .where(
            and(
              eq(clients.id, requestedClientId),
              eq(clients.userId, row.userId),
              isNull(clients.revokedAt),
            ),
          )
          .limit(1);

        if (!client) {
          throw new HomiContextError(
            403,
            "CLIENT_ACCESS_DENIED",
            "The Homi client is not valid for the authenticated user.",
          );
        }

        clientId = client.id;
      }

      return {
        requestId: input.requestId,
        userId: row.userId,
        householdId: row.householdId,
        membershipId: row.membershipId,
        householdPersonId: row.householdPersonId,
        ...(clientId ? { clientId } : {}),
        locale: row.preferredLocale || row.householdLocale,
        timeZone: row.userTimeZone || row.householdTimeZone,
      };
    },
  };
}
