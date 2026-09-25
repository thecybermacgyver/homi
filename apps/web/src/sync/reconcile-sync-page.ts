import {
  applySyncActions,
  getLastAppliedSequence,
  type LocalCacheApplyAction,
} from "./local-db.js";
import type {
  SyncChange,
  SyncChangePage,
  SyncCursorStatus,
} from "./sync-feed.js";

export interface SyncChangeHandlerContext {
  readonly householdId: string;
  readonly clientId: string;
}

export interface SyncChangeHandler {
  readonly moduleKey: string;
  readonly entityType: string;
  materialize(
    change: SyncChange,
    context: SyncChangeHandlerContext,
    signal?: AbortSignal,
  ): Promise<LocalCacheApplyAction>;
}

export interface SyncReconciliationDependencies {
  pullSyncChanges(
    input: {
      householdId: string;
      clientId: string;
      afterSequence: string;
      limit?: number;
    },
    signal?: AbortSignal,
  ): Promise<SyncChangePage>;
  acknowledgeSyncCursor(
    input: {
      householdId: string;
      clientId: string;
      lastChangeSequence: string;
    },
    signal?: AbortSignal,
  ): Promise<SyncCursorStatus>;
}

export interface SyncPageReconciliationResult {
  readonly afterSequence: string;
  readonly nextSequence: string;
  readonly changeCount: number;
  readonly hasMore: boolean;
  readonly completedMutationIds: readonly string[];
  readonly serverCursor: string;
}

export class SyncReconciliationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "SyncReconciliationError";
  }
}

function handlerKey(moduleKey: string, entityType: string): string {
  return JSON.stringify([moduleKey, entityType]);
}

function requireHandlerMap(
  handlers: readonly SyncChangeHandler[],
): Map<string, SyncChangeHandler> {
  const map = new Map<string, SyncChangeHandler>();
  for (const handler of handlers) {
    if (
      !handler ||
      typeof handler.moduleKey !== "string" ||
      handler.moduleKey.trim().length === 0 ||
      typeof handler.entityType !== "string" ||
      handler.entityType.trim().length === 0 ||
      typeof handler.materialize !== "function"
    ) {
      throw new SyncReconciliationError(
        "SYNC_RECONCILIATION_INVALID_HANDLER",
        "Every sync handler must declare moduleKey, entityType and materialize().",
      );
    }
    const key = handlerKey(handler.moduleKey, handler.entityType);
    if (map.has(key)) {
      throw new SyncReconciliationError(
        "SYNC_RECONCILIATION_DUPLICATE_HANDLER",
        "Only one sync handler may own a module/entity type pair.",
      );
    }
    map.set(key, handler);
  }
  return map;
}

function checkCancellation(signal?: AbortSignal): void {
  try {
    signal?.throwIfAborted();
  } catch (cause) {
    throw new SyncReconciliationError(
      "SYNC_RECONCILIATION_CANCELLED",
      "Synchronization reconciliation was cancelled.",
      { cause },
    );
  }
}

function validateAction(
  change: SyncChange,
  action: LocalCacheApplyAction,
): void {
  if (
    !action ||
    action.moduleKey !== change.moduleKey ||
    action.entityType !== change.entityType ||
    action.entityId !== change.entityId ||
    action.sequence !== change.sequence
  ) {
    throw new SyncReconciliationError(
      "SYNC_RECONCILIATION_INVALID_ACTION",
      "A sync handler returned an action for the wrong change identity.",
    );
  }
}

export async function reconcileOneSyncPage(
  dependencies: SyncReconciliationDependencies,
  input: {
    authSubject: string;
    householdId: string;
    clientId: string;
    handlers: readonly SyncChangeHandler[];
    limit?: number;
  },
  signal?: AbortSignal,
): Promise<SyncPageReconciliationResult> {
  const handlers = requireHandlerMap(input.handlers);
  checkCancellation(signal);

  const afterSequence = await getLastAppliedSequence(
    input.authSubject,
    input.householdId,
  );
  checkCancellation(signal);

  const page = await dependencies.pullSyncChanges(
    {
      householdId: input.householdId,
      clientId: input.clientId,
      afterSequence,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    },
    signal,
  );
  checkCancellation(signal);

  const actions: LocalCacheApplyAction[] = [];
  for (const change of page.changes) {
    const handler = handlers.get(handlerKey(change.moduleKey, change.entityType));
    try {
      if (!handler) {
        throw new SyncReconciliationError(
          "SYNC_RECONCILIATION_UNSUPPORTED_CHANGE",
          `No sync handler is registered for ${change.moduleKey}/${change.entityType}.`,
        );
      }
      const action = await handler.materialize(
        change,
        {
          householdId: input.householdId,
          clientId: input.clientId,
        },
        signal,
      );
      checkCancellation(signal);
      validateAction(change, action);
      actions.push(action);
    } catch (error) {
      checkCancellation(signal);
      const code =
        error instanceof SyncReconciliationError
          ? error.code
          : error instanceof Error &&
              "code" in error &&
              typeof error.code === "string"
            ? error.code
            : "SYNC_CHANGE_MATERIALIZATION_FAILED";
      actions.push(Object.freeze({
        kind: "defer" as const,
        moduleKey: change.moduleKey,
        entityType: change.entityType,
        entityId: change.entityId,
        sequence: change.sequence,
        operation: change.operation,
        revision: change.revision,
        changedByUserId: change.changedByUserId,
        clientId: change.clientId,
        changedAt: change.changedAt,
        errorCode: code,
        errorMessage:
          error instanceof Error
            ? error.message
            : "The module change could not be materialized.",
      }));
    }
  }

  const applied = await applySyncActions(
    input.authSubject,
    input.householdId,
    page.nextSequence,
    actions,
  );

  checkCancellation(signal);
  const cursor = await dependencies.acknowledgeSyncCursor(
    {
      householdId: input.householdId,
      clientId: input.clientId,
      lastChangeSequence: applied.lastAppliedSequence,
    },
    signal,
  );
  checkCancellation(signal);

  return Object.freeze({
    afterSequence,
    nextSequence: applied.lastAppliedSequence,
    changeCount: page.changes.length,
    hasMore: page.hasMore,
    completedMutationIds: Object.freeze([...applied.completedMutationIds]),
    serverCursor: cursor.lastChangeSequence,
  });
}
