import type {
  HouseholdModuleSnapshot,
  HouseholdModuleCatalog,
} from "./household-modules.js";
import type {
  SyncChangeHandler,
  SyncChangeHandlerContext,
} from "./reconcile-sync-page.js";
import type { SyncChange } from "./sync-feed.js";
import type { LocalCacheApplyAction } from "./local-db.js";

export interface CoreHouseholdModuleHandlerDependencies {
  fetchHouseholdModules(
    input: {
      householdId: string;
      clientId: string;
    },
    signal?: AbortSignal,
  ): Promise<HouseholdModuleCatalog>;
}

export class CoreHouseholdModuleSyncHandlerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CoreHouseholdModuleSyncHandlerError";
  }
}

function compareNonNegativeIntegers(
  left: string,
  right: string,
): number {
  if (
    !/^(0|[1-9][0-9]*)$/.test(left) ||
    !/^(0|[1-9][0-9]*)$/.test(right)
  ) {
    throw new CoreHouseholdModuleSyncHandlerError(
      "CORE_HOUSEHOLD_MODULE_SYNC_INVALID_REVISION",
      "Household module revisions must be non-negative integer strings.",
    );
  }

  return left.length === right.length
    ? left.localeCompare(right)
    : left.length - right.length;
}

function findSnapshot(
  catalog: HouseholdModuleCatalog,
  entityId: string,
): HouseholdModuleSnapshot | null {
  return (
    catalog.modules.find(
      (module) =>
        module.id.toLowerCase() === entityId.toLowerCase(),
    ) ?? null
  );
}

export function createCoreHouseholdModuleSyncHandler(
  dependencies: CoreHouseholdModuleHandlerDependencies,
): SyncChangeHandler {
  return Object.freeze({
    moduleKey: "core",
    entityType: "household-module",

    async materialize(
      change: SyncChange,
      context: SyncChangeHandlerContext,
      signal?: AbortSignal,
    ): Promise<LocalCacheApplyAction> {
      if (
        change.householdId.toLowerCase() !==
        context.householdId.toLowerCase()
      ) {
        throw new CoreHouseholdModuleSyncHandlerError(
          "CORE_HOUSEHOLD_MODULE_SYNC_IDENTITY_MISMATCH",
          "The household module change does not match the active household.",
        );
      }

      if (
        change.operation !== "create" &&
        change.operation !== "update"
      ) {
        throw new CoreHouseholdModuleSyncHandlerError(
          "CORE_HOUSEHOLD_MODULE_SYNC_UNSUPPORTED_OPERATION",
          "Household module sync supports create and update changes only.",
        );
      }

      const catalog = await dependencies.fetchHouseholdModules(
        {
          householdId: context.householdId,
          clientId: context.clientId,
        },
        signal,
      );
      const snapshot = findSnapshot(
        catalog,
        change.entityId,
      );

      if (!snapshot) {
        return Object.freeze({
          kind: "delete" as const,
          moduleKey: change.moduleKey,
          entityType: change.entityType,
          entityId: change.entityId,
          sequence: change.sequence,
        });
      }

      if (
        compareNonNegativeIntegers(
          snapshot.revision,
          change.revision,
        ) < 0
      ) {
        throw new CoreHouseholdModuleSyncHandlerError(
          "CORE_HOUSEHOLD_MODULE_SYNC_STALE_SNAPSHOT",
          "The authoritative module snapshot is older than the change being applied.",
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
