import { sql } from "drizzle-orm";
import type { HomiDatabase } from "@homi/db";
import type { HomiRequestContext } from "./context.js";

export interface HomiAuthorization {
  listPermissions(
    context: HomiRequestContext,
  ): Promise<string[]>;
  hasPermission(
    context: HomiRequestContext,
    permissionKey: string,
  ): Promise<boolean>;
  requirePermission(
    context: HomiRequestContext,
    permissionKey: string,
  ): Promise<void>;
}

export class HomiAuthorizationError extends Error {
  readonly statusCode = 403;
  readonly code = "PERMISSION_DENIED";

  constructor(permissionKey: string) {
    super(`Permission '${permissionKey}' is required.`);
    this.name = "HomiAuthorizationError";
  }
}

export function createHomiAuthorization(
  database: HomiDatabase["db"],
): HomiAuthorization {
  async function listPermissions(
    context: HomiRequestContext,
  ): Promise<string[]> {
    const result = await database.execute(sql`
      SELECT DISTINCT p.key AS "permissionKey"
      FROM core.membership_roles AS mr
      INNER JOIN core.roles AS r
        ON r.id = mr.role_id
      INNER JOIN core.role_permissions AS rp
        ON rp.role_id = r.id
      INNER JOIN core.permissions AS p
        ON p.key = rp.permission_key
      WHERE mr.membership_id = CAST(${context.membershipId} AS uuid)
        AND (
          r.household_id IS NULL
          OR r.household_id = CAST(${context.householdId} AS uuid)
        )
      ORDER BY p.key
    `);

    return (
      result.rows as Array<{ permissionKey: string }>
    ).map((row) => row.permissionKey);
  }

  return {
    listPermissions,

    async hasPermission(context, permissionKey) {
      const permissions = await listPermissions(context);
      return permissions.includes(permissionKey);
    },

    async requirePermission(context, permissionKey) {
      if (!(await this.hasPermission(context, permissionKey))) {
        throw new HomiAuthorizationError(permissionKey);
      }
    },
  };
}
