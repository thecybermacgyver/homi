import type { HouseholdSettingsSnapshot } from "./fetch-household-settings.js";
import type {
  SyncChangeHandler,
  SyncChangeHandlerContext,
} from "./reconcile-sync-page.js";
import type { SyncChange } from "./sync-feed.js";
import type { LocalCacheApplyAction } from "./local-db.js";

export interface CoreHouseholdHandlerDependencies {
  fetchHouseholdSettings(
    input: { householdId: string; clientId: string },
    signal?: AbortSignal,
  ): Promise<HouseholdSettingsSnapshot>;
}

export class CoreHouseholdSyncHandlerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "CoreHouseholdSyncHandlerError";
  }
}

function comparePositiveIntegers(left: string, right: string): number {
  if (!/^[1-9][0-9]*$/.test(left) || !/^[1-9][0-9]*$/.test(right)) {
    throw new CoreHouseholdSyncHandlerError(
      "CORE_HOUSEHOLD_SYNC_INVALID_REVISION",
      "Household revisions must be positive integer strings.",
    );
  }
  return left.length === right.length
    ? left.localeCompare(right)
    : left.length - right.length;
}

export function createCoreHouseholdSyncHandler(
  dependencies: CoreHouseholdHandlerDependencies,
): SyncChangeHandler {
  return Object.freeze({
    moduleKey: "core",
    entityType: "household",
    async materialize(
      change: SyncChange,
      context: SyncChangeHandlerContext,
      signal?: AbortSignal,
    ): Promise<LocalCacheApplyAction> {
      if (
        change.householdId.toLowerCase() !== context.householdId.toLowerCase() ||
        change.entityId.toLowerCase() !== context.householdId.toLowerCase()
      ) {
        throw new CoreHouseholdSyncHandlerError(
          "CORE_HOUSEHOLD_SYNC_IDENTITY_MISMATCH",
          "The household change does not match the active household.",
        );
      }

      if (change.operation !== "create" && change.operation !== "update") {
        throw new CoreHouseholdSyncHandlerError(
          "CORE_HOUSEHOLD_SYNC_UNSUPPORTED_OPERATION",
          `Unsupported household sync operation '${change.operation}'.`,
        );
      }

      const snapshot = await dependencies.fetchHouseholdSettings(
        {
          householdId: context.householdId,
          clientId: context.clientId,
        },
        signal,
      );

      if (
        snapshot.id.toLowerCase() !== change.entityId.toLowerCase() ||
        comparePositiveIntegers(snapshot.revision, change.revision) < 0
      ) {
        throw new CoreHouseholdSyncHandlerError(
          "CORE_HOUSEHOLD_SYNC_STALE_SNAPSHOT",
          "The authoritative household snapshot is older than the change being applied.",
        );
      }

      return Object.freeze({
        kind: "put" as const,
        moduleKey: change.moduleKey,
        entityType: change.entityType,
        entityId: change.entityId,
        revision: snapshot.revision,
        sequence: change.sequence,
        data: snapshot,
      });
    },
  });
}
