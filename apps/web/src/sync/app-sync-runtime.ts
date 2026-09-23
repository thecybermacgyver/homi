import {
  createSyncContextCoordinator,
  type SyncContextSnapshot,
} from "./context-coordinator.js";
import { createCoreHouseholdSyncHandler } from "./core-household-sync-handler.js";
import { createCoreHouseholdModuleSyncHandler } from "./core-household-module-sync-handler.js";
import { coreMemberModulePreferenceSyncHandler } from "./core-member-module-preference-sync-handler.js";
import { coreHouseholdMutationAdapter } from "./core-mutation-adapter.js";
import { memberModulePreferenceMutationAdapter } from "./member-module-preference-adapter.js";
import {
  deliverQueuedMutationBatch,
  type MutationDeliveryAdapter,
} from "./deliver-mutations.js";
import { discoverHouseholds } from "./discover-households.js";
import { fetchHouseholdSettings } from "./fetch-household-settings.js";
import { fetchHouseholdModules } from "./household-modules.js";
import { initializeClient } from "./initialize-client.js";
import {
  clearActiveOfflineContext,
  getActiveOfflineContext,
  recoverInterruptedMutations,
  setActiveOfflineContext,
  type OfflineActiveContext,
} from "./local-db.js";
import {
  reconcileOneSyncPage,
  type SyncChangeHandler,
} from "./reconcile-sync-page.js";
import { resolveSyncContext } from "./resolve-context.js";
import {
  createSyncCycleCoordinator,
  type SyncCycleResult,
} from "./sync-cycle.js";
import {
  acknowledgeSyncCursor,
  pullSyncChanges,
} from "./sync-feed.js";

export type AppSyncActivity =
  | "idle"
  | "refreshing-context"
  | "synchronizing";

export interface AppSyncSnapshot {
  readonly context: SyncContextSnapshot;
  readonly activity: AppSyncActivity;
  readonly lastCycle: SyncCycleResult | null;
  readonly lastSuccessfulSyncAt: string | null;
  readonly offlineContext: OfflineActiveContext | null;
}

export interface AppSyncRuntime {
  getSnapshot(): AppSyncSnapshot;
  subscribe(listener: () => void): () => void;
  hydrateOfflineContext(): Promise<void>;
  clearOfflineContext(): Promise<void>;
  refreshContext(signal?: AbortSignal): Promise<void>;
  selectHousehold(householdId: string, signal?: AbortSignal): Promise<boolean>;
  clearSelection(): void;
  setModuleSyncContributions(input: {
    readonly mutationAdapters: readonly MutationDeliveryAdapter[];
    readonly changeHandlers: readonly SyncChangeHandler[];
  }): void;
  syncNow(signal?: AbortSignal): Promise<SyncCycleResult>;
  invalidate(): void;
}

function freezeSnapshot(
  context: SyncContextSnapshot,
  activity: AppSyncActivity,
  lastCycle: SyncCycleResult | null,
  lastSuccessfulSyncAt: string | null,
  offlineContext: OfflineActiveContext | null,
): AppSyncSnapshot {
  return Object.freeze({
    context,
    activity,
    lastCycle,
    lastSuccessfulSyncAt,
    offlineContext,
  });
}

export function createAppSyncRuntime(): AppSyncRuntime {
  const contextCoordinator = createSyncContextCoordinator({
    discoverHouseholds,
    initializeClient,
    resolveSyncContext,
  });

  const householdHandler = createCoreHouseholdSyncHandler({
    fetchHouseholdSettings,
  });
  const householdModuleHandler =
    createCoreHouseholdModuleSyncHandler({
      fetchHouseholdModules,
    });
  let moduleMutationAdapters:
    readonly MutationDeliveryAdapter[] = Object.freeze([]);
  let moduleChangeHandlers:
    readonly SyncChangeHandler[] = Object.freeze([]);

  const syncCycle = createSyncCycleCoordinator({
    getContextSnapshot: () => contextCoordinator.getSnapshot(),
    recoverInterruptedMutations,
    deliverQueuedMutationBatch: (input, signal) =>
      deliverQueuedMutationBatch(
        {
          adapters: [
            coreHouseholdMutationAdapter,
            memberModulePreferenceMutationAdapter,
            ...moduleMutationAdapters,
          ],
        },
        input,
        signal,
      ),
    reconcileOneSyncPage: (input, signal) =>
      reconcileOneSyncPage(
        {
          pullSyncChanges,
          acknowledgeSyncCursor,
        },
        input,
        signal,
      ),
    getHandlers: () => [
      householdHandler,
      householdModuleHandler,
      coreMemberModulePreferenceSyncHandler,
      ...moduleChangeHandlers,
    ],
  });

  const listeners = new Set<() => void>();
  let activity: AppSyncActivity = "idle";
  let lastCycle: SyncCycleResult | null = null;
  let lastSuccessfulSyncAt: string | null = null;
  let offlineContext: OfflineActiveContext | null = null;
  let snapshot = freezeSnapshot(
    contextCoordinator.getSnapshot(),
    activity,
    lastCycle,
    lastSuccessfulSyncAt,
    offlineContext,
  );

  function publish(): void {
    snapshot = freezeSnapshot(
      contextCoordinator.getSnapshot(),
      activity,
      lastCycle,
      lastSuccessfulSyncAt,
      offlineContext,
    );
    for (const listener of listeners) {
      listener();
    }
  }

  async function persistReadyOfflineContext(): Promise<void> {
    const current = contextCoordinator.getSnapshot();
    if (
      current.status !== "ready" ||
      current.context === null ||
      current.household.authSubject === null ||
      current.household.selectedHouseholdId === null
    ) {
      return;
    }
    const householdName =
      current.household.candidates?.households.find(
        (item) => item.householdId === current.household.selectedHouseholdId,
      )?.name ?? "Household";
    offlineContext = await setActiveOfflineContext({
      authSubject: current.household.authSubject,
      householdId: current.context.householdId,
      clientId: current.context.clientId,
      coreUserId: current.context.userId,
      householdName,
      locale: current.context.locale,
      timeZone: current.context.timeZone,
    });
    publish();
  }

  async function synchronize(
    signal?: AbortSignal,
  ): Promise<SyncCycleResult> {
    activity = "synchronizing";
    publish();

    try {
      const result = await syncCycle.runOnce({}, signal);
      lastCycle = result;
      if (result.status === "completed") {
        lastSuccessfulSyncAt = new Date().toISOString();
      }
      return result;
    } finally {
      activity = "idle";
      publish();
    }
  }

  return Object.freeze({
    getSnapshot() {
      return snapshot;
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async hydrateOfflineContext() {
      offlineContext = await getActiveOfflineContext();
      publish();
    },

    async clearOfflineContext() {
      await clearActiveOfflineContext();
      offlineContext = null;
      publish();
    },

    async refreshContext(signal?: AbortSignal) {
      activity = "refreshing-context";
      publish();

      try {
        await contextCoordinator.refresh();
      } finally {
        activity = "idle";
        publish();
      }

      const current = contextCoordinator.getSnapshot();
      if (current.status === "ready") {
        await persistReadyOfflineContext();
      } else if (current.status === "unauthenticated") {
        await clearActiveOfflineContext();
        offlineContext = null;
        publish();
      }

      signal?.throwIfAborted();
    },

    async selectHousehold(householdId: string, signal?: AbortSignal) {
      activity = "refreshing-context";
      publish();

      let accepted = false;
      try {
        accepted = await contextCoordinator.selectHousehold(householdId);
      } finally {
        activity = "idle";
        publish();
      }

      if (
        accepted &&
        contextCoordinator.getSnapshot().status === "ready"
      ) {
        await persistReadyOfflineContext();
      }

      signal?.throwIfAborted();
      return accepted;
    },

    clearSelection() {
      contextCoordinator.clearSelection();
      moduleMutationAdapters = Object.freeze([]);
      moduleChangeHandlers = Object.freeze([]);
      lastCycle = null;
      publish();
    },

    setModuleSyncContributions(input: {
      readonly mutationAdapters: readonly MutationDeliveryAdapter[];
      readonly changeHandlers: readonly SyncChangeHandler[];
    }) {
      moduleMutationAdapters = Object.freeze([
        ...input.mutationAdapters,
      ]);
      moduleChangeHandlers = Object.freeze([
        ...input.changeHandlers,
      ]);
    },

    syncNow(signal?: AbortSignal) {
      return synchronize(signal);
    },

    invalidate() {
      contextCoordinator.invalidate();
      moduleMutationAdapters = Object.freeze([]);
      moduleChangeHandlers = Object.freeze([]);
      lastCycle = null;
      activity = "idle";
      publish();
    },
  });
}
