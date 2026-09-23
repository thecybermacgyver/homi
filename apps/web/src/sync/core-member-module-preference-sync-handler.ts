import {
  fetchMemberModulePreferences,
  type MemberModulePreferenceSnapshot,
} from "./member-module-preferences.js";
import type {
  SyncChangeHandler,
  SyncChangeHandlerContext,
} from "./reconcile-sync-page.js";
import type { SyncChange } from "./sync-feed.js";
import type { LocalCacheApplyAction } from "./local-db.js";

export class CoreMemberModulePreferenceSyncHandlerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CoreMemberModulePreferenceSyncHandlerError";
  }
}

function comparePositiveIntegers(
  left: string,
  right: string,
): number {
  if (
    !/^[1-9][0-9]*$/.test(left) ||
    !/^[1-9][0-9]*$/.test(right)
  ) {
    throw new CoreMemberModulePreferenceSyncHandlerError(
      "CORE_MEMBER_MODULE_PREFERENCE_INVALID_REVISION",
      "Personal module preference revisions must be positive integer strings.",
    );
  }
  return left.length === right.length
    ? left.localeCompare(right)
    : left.length - right.length;
}

function findPreference(
  preferences: readonly MemberModulePreferenceSnapshot[],
  entityId: string,
): MemberModulePreferenceSnapshot | null {
  return (
    preferences.find(
      (preference) =>
        preference.id.toLowerCase() === entityId.toLowerCase(),
    ) ?? null
  );
}

export const coreMemberModulePreferenceSyncHandler:
  SyncChangeHandler = Object.freeze({
    moduleKey: "core",
    entityType: "member-module-preference",

    async materialize(
      change: SyncChange,
      context: SyncChangeHandlerContext,
      signal?: AbortSignal,
    ): Promise<LocalCacheApplyAction> {
      if (
        change.householdId.toLowerCase() !==
        context.householdId.toLowerCase() ||
        change.operation !== "update"
      ) {
        throw new CoreMemberModulePreferenceSyncHandlerError(
          "CORE_MEMBER_MODULE_PREFERENCE_CHANGE_INVALID",
          "The personal module preference change is invalid for the active household.",
        );
      }

      const preferences =
        await fetchMemberModulePreferences(
          {
            householdId: context.householdId,
            clientId: context.clientId,
          },
          signal,
        );
      const preference = findPreference(
        preferences,
        change.entityId,
      );

      if (
        !preference ||
        comparePositiveIntegers(
          preference.revision,
          change.revision,
        ) < 0
      ) {
        throw new CoreMemberModulePreferenceSyncHandlerError(
          "CORE_MEMBER_MODULE_PREFERENCE_STALE_SNAPSHOT",
          "The authoritative personal module preference is missing or older than the sync change.",
        );
      }

      return Object.freeze({
        kind: "put" as const,
        moduleKey: change.moduleKey,
        entityType: change.entityType,
        entityId: change.entityId,
        revision: preference.revision,
        sequence: change.sequence,
        data: preference,
      });
    },
  });
