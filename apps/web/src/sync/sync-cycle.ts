import type { SyncContextSnapshot } from "./context-coordinator.js";
import type {
  MutationDeliverySummary,
} from "./deliver-mutations.js";
import type {
  SyncChangeHandler,
  SyncPageReconciliationResult,
} from "./reconcile-sync-page.js";

export interface SyncCycleDependencies {
  getContextSnapshot(): SyncContextSnapshot;
  recoverInterruptedMutations(authSubject: string): Promise<number>;
  deliverQueuedMutationBatch(
    input: {
      authSubject: string;
      householdId: string;
      clientId: string;
      limit?: number;
    },
    signal?: AbortSignal,
  ): Promise<MutationDeliverySummary>;
  reconcileOneSyncPage(
    input: {
      authSubject: string;
      householdId: string;
      clientId: string;
      handlers: readonly SyncChangeHandler[];
      limit?: number;
    },
    signal?: AbortSignal,
  ): Promise<SyncPageReconciliationResult>;
  getHandlers(): readonly SyncChangeHandler[];
}

export interface SyncCycleFailure {
  readonly code: string;
  readonly message: string;
}

export interface SyncCycleResult {
  readonly status:
    | "not-ready"
    | "completed"
    | "stale"
    | "cancelled"
    | "failed";
  readonly recoveredMutations: number;
  readonly delivery: MutationDeliverySummary | null;
  readonly pages: readonly SyncPageReconciliationResult[];
  readonly failure: SyncCycleFailure | null;
}

export interface SyncCycleCoordinator {
  runOnce(
    options?: {
      mutationLimit?: number;
      changeLimit?: number;
      maxPages?: number;
    },
    signal?: AbortSignal,
  ): Promise<SyncCycleResult>;
}

interface ReadyToken {
  readonly authSubject: string;
  readonly householdRevision: bigint;
  readonly householdId: string;
  readonly clientId: string;
  readonly requestId: string;
}

function frozenResult(
  status: SyncCycleResult["status"],
  recoveredMutations: number,
  delivery: MutationDeliverySummary | null,
  pages: readonly SyncPageReconciliationResult[],
  failure: SyncCycleFailure | null,
): SyncCycleResult {
  return Object.freeze({
    status,
    recoveredMutations,
    delivery,
    pages: Object.freeze([...pages]),
    failure,
  });
}

function failureDetail(error: unknown): SyncCycleFailure {
  const source = typeof error === "object" && error !== null ? error : {};
  return Object.freeze({
    code:
      "code" in source && typeof source.code === "string"
        ? source.code
        : "SYNC_CYCLE_FAILED",
    message:
      "message" in source && typeof source.message === "string"
        ? source.message
        : "The synchronization cycle failed.",
  });
}

function readyToken(snapshot: SyncContextSnapshot): ReadyToken | null {
  if (
    snapshot.status !== "ready" ||
    snapshot.context === null ||
    snapshot.household.authSubject === null ||
    snapshot.household.selectedHouseholdId === null
  ) {
    return null;
  }

  return Object.freeze({
    authSubject: snapshot.household.authSubject,
    householdRevision: snapshot.household.revision,
    householdId: snapshot.context.householdId,
    clientId: snapshot.context.clientId,
    requestId: snapshot.context.requestId,
  });
}

function sameReady(
  snapshot: SyncContextSnapshot,
  token: ReadyToken,
): boolean {
  const next = readyToken(snapshot);
  return (
    next !== null &&
    next.authSubject === token.authSubject &&
    next.householdRevision === token.householdRevision &&
    next.householdId === token.householdId &&
    next.clientId === token.clientId &&
    next.requestId === token.requestId
  );
}

function fatalDeliveryCode(code: string | null): boolean {
  return (
    code === "AUTHENTICATION_REQUIRED" ||
    code === "HOUSEHOLD_ACCESS_DENIED" ||
    code === "CLIENT_ACCESS_DENIED" ||
    code === "CLIENT_REVOKED" ||
    code === "CORE_USER_UNAVAILABLE"
  );
}

function validateOptions(options: {
  mutationLimit?: number;
  changeLimit?: number;
  maxPages?: number;
}): Required<{
  mutationLimit: number;
  changeLimit: number;
  maxPages: number;
}> {
  const mutationLimit = options.mutationLimit ?? 100;
  const changeLimit = options.changeLimit ?? 100;
  const maxPages = options.maxPages ?? 10;
  if (
    !Number.isSafeInteger(mutationLimit) ||
    mutationLimit < 1 ||
    mutationLimit > 100 ||
    !Number.isSafeInteger(changeLimit) ||
    changeLimit < 1 ||
    changeLimit > 500 ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 100
  ) {
    throw new Error("Invalid sync cycle limits.");
  }
  return { mutationLimit, changeLimit, maxPages };
}

// Explicit foreground cycle only. Calls are serialized within this coordinator;
// no timer, online listener, React lifecycle, retry loop, or cross-tab owner exists.
export function createSyncCycleCoordinator(
  dependencies: SyncCycleDependencies,
): SyncCycleCoordinator {
  let tail: Promise<void> = Promise.resolve();

  async function execute(
    options: {
      mutationLimit?: number;
      changeLimit?: number;
      maxPages?: number;
    },
    signal?: AbortSignal,
  ): Promise<SyncCycleResult> {
    const limits = validateOptions(options);
    if (signal?.aborted) {
      return frozenResult("cancelled", 0, null, [], null);
    }

    const token = readyToken(dependencies.getContextSnapshot());
    if (!token) {
      return frozenResult("not-ready", 0, null, [], null);
    }

    let recoveredMutations = 0;
    let delivery: MutationDeliverySummary | null = null;
    const pages: SyncPageReconciliationResult[] = [];

    const current = () =>
      sameReady(dependencies.getContextSnapshot(), token);

    try {
      recoveredMutations =
        await dependencies.recoverInterruptedMutations(token.authSubject);
      if (signal?.aborted) {
        return frozenResult(
          "cancelled",
          recoveredMutations,
          null,
          pages,
          null,
        );
      }
      if (!current()) {
        return frozenResult(
          "stale",
          recoveredMutations,
          null,
          pages,
          null,
        );
      }

      delivery = await dependencies.deliverQueuedMutationBatch(
        {
          authSubject: token.authSubject,
          householdId: token.householdId,
          clientId: token.clientId,
          limit: limits.mutationLimit,
        },
        signal,
      );
      if (signal?.aborted) {
        return frozenResult(
          "cancelled",
          recoveredMutations,
          delivery,
          pages,
          null,
        );
      }
      if (!current()) {
        return frozenResult(
          "stale",
          recoveredMutations,
          delivery,
          pages,
          null,
        );
      }
      if (fatalDeliveryCode(delivery.stop?.code ?? null)) {
        return frozenResult(
          "failed",
          recoveredMutations,
          delivery,
          pages,
          Object.freeze({
            code: delivery.stop!.code,
            message: delivery.stop!.message,
          }),
        );
      }

      for (let index = 0; index < limits.maxPages; index += 1) {
        const page = await dependencies.reconcileOneSyncPage(
          {
            authSubject: token.authSubject,
            householdId: token.householdId,
            clientId: token.clientId,
            handlers: dependencies.getHandlers(),
            limit: limits.changeLimit,
          },
          signal,
        );
        pages.push(page);

        if (signal?.aborted) {
          return frozenResult(
            "cancelled",
            recoveredMutations,
            delivery,
            pages,
            null,
          );
        }
        if (!current()) {
          return frozenResult(
            "stale",
            recoveredMutations,
            delivery,
            pages,
            null,
          );
        }
        if (!page.hasMore) {
          return frozenResult(
            "completed",
            recoveredMutations,
            delivery,
            pages,
            null,
          );
        }
      }

      return frozenResult(
        "failed",
        recoveredMutations,
        delivery,
        pages,
        Object.freeze({
          code: "SYNC_CYCLE_PAGE_LIMIT",
          message: "Synchronization still has more changes after the bounded page limit.",
        }),
      );
    } catch (error) {
      if (signal?.aborted) {
        return frozenResult(
          "cancelled",
          recoveredMutations,
          delivery,
          pages,
          null,
        );
      }
      if (!current()) {
        return frozenResult(
          "stale",
          recoveredMutations,
          delivery,
          pages,
          null,
        );
      }
      return frozenResult(
        "failed",
        recoveredMutations,
        delivery,
        pages,
        failureDetail(error),
      );
    }
  }

  return Object.freeze({
    runOnce(
      options: {
        mutationLimit?: number;
        changeLimit?: number;
        maxPages?: number;
      } = {},
      signal?: AbortSignal,
    ) {
      let resolveResult!: (value: SyncCycleResult) => void;
      let rejectResult!: (reason?: unknown) => void;
      const result = new Promise<SyncCycleResult>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });

      const run = tail.then(async () => {
        try {
          resolveResult(await execute(options, signal));
        } catch (error) {
          rejectResult(error);
        }
      });
      tail = run.then(() => undefined, () => undefined);
      return result;
    },
  });
}
