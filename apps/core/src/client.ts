import {
  clients,
  users,
  type HomiDatabase,
} from "@homi/db";
import { and, eq, isNull } from "drizzle-orm";

export interface RegisterHomiClientInput {
  clientInstanceId: string;
  label?: string;
  platform?: string;
  appVersion?: string;
}

export interface RegisteredHomiClient {
  id: string;
  clientInstanceId: string;
  label: string | null;
  platform: string | null;
  appVersion: string | null;
  lastSeenAt: Date;
}

export class HomiClientError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HomiClientError";
  }
}

export interface HomiClientService {
  register(
    authSubject: string,
    input: RegisterHomiClientInput,
  ): Promise<RegisteredHomiClient>;
}

export function createHomiClientService(
  database: HomiDatabase["db"],
): HomiClientService {
  return {
    async register(authSubject, input) {
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
        throw new HomiClientError(
          403,
          "CORE_USER_UNAVAILABLE",
          "The authenticated account is not an active Homi user.",
        );
      }

      const [existing] = await database
        .select({
          id: clients.id,
          clientInstanceId: clients.clientInstanceId,
          label: clients.label,
          platform: clients.platform,
          appVersion: clients.appVersion,
          revokedAt: clients.revokedAt,
        })
        .from(clients)
        .where(
          and(
            eq(clients.userId, user.id),
            eq(clients.clientInstanceId, input.clientInstanceId),
          ),
        )
        .limit(1);

      if (existing?.revokedAt) {
        throw new HomiClientError(
          403,
          "CLIENT_REVOKED",
          "This Homi client has been revoked.",
        );
      }

      const now = new Date();

      if (existing) {
        const [updated] = await database
          .update(clients)
          .set({
            label: input.label ?? existing.label,
            platform: input.platform ?? existing.platform,
            appVersion: input.appVersion ?? existing.appVersion,
            lastSeenAt: now,
          })
          .where(eq(clients.id, existing.id))
          .returning({
            id: clients.id,
            clientInstanceId: clients.clientInstanceId,
            label: clients.label,
            platform: clients.platform,
            appVersion: clients.appVersion,
            lastSeenAt: clients.lastSeenAt,
          });

        if (!updated?.lastSeenAt) {
          throw new HomiClientError(
            500,
            "CLIENT_REGISTRATION_FAILED",
            "The Homi client could not be registered.",
          );
        }

        return {
          ...updated,
          lastSeenAt: updated.lastSeenAt,
        };
      }

      const [created] = await database
        .insert(clients)
        .values({
          userId: user.id,
          clientInstanceId: input.clientInstanceId,
          label: input.label,
          platform: input.platform,
          appVersion: input.appVersion,
          lastSeenAt: now,
        })
        .returning({
          id: clients.id,
          clientInstanceId: clients.clientInstanceId,
          label: clients.label,
          platform: clients.platform,
          appVersion: clients.appVersion,
          lastSeenAt: clients.lastSeenAt,
        });

      if (!created?.lastSeenAt) {
        throw new HomiClientError(
          500,
          "CLIENT_REGISTRATION_FAILED",
          "The Homi client could not be registered.",
        );
      }

      return {
        ...created,
        lastSeenAt: created.lastSeenAt,
      };
    },
  };
}
