import {
  getQueuedMutations,
  markMutationApplied,
  markMutationConflict,
  markMutationRejected,
  markMutationSending,
  returnMutationToQueue,
  type MutationResultSnapshot,
  type QueuedMutation,
} from "./local-db.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface MutationSubmissionResult {
  readonly clientMutationId: string;
  readonly status: "received" | "applied" | "conflict" | "rejected";
  readonly serverRevision: string | null;
  readonly changeSequence: string | null;
  readonly errorCode: string | null;
  readonly serverState: unknown;
  readonly replayed: boolean;
}

export interface MutationDeliveryAdapter {
  readonly moduleKey: string;
  readonly entityType: string;
  readonly operations: readonly string[];
  submit(
    mutation: QueuedMutation,
    clientId: string,
    signal?: AbortSignal,
  ): Promise<MutationSubmissionResult>;
}

export interface MutationDeliveryDependencies {
  readonly adapters: readonly MutationDeliveryAdapter[];
}

export interface MutationDeliveryInput {
  readonly authSubject: string;
  readonly householdId: string;
  readonly clientId: string;
  readonly limit?: number;
}

export interface MutationDeliveryStop {
  readonly code: string;
  readonly message: string;
  readonly status: number | null;
  readonly requestId: string | null;
}

export interface MutationDeliverySummary {
  readonly attempted: number;
  readonly applied: number;
  readonly conflicts: number;
  readonly rejected: number;
  readonly deferred: number;
  readonly stop: MutationDeliveryStop | null;
}

export class MutationDeliveryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "MutationDeliveryError";
  }
}

function validateInput(input: MutationDeliveryInput): number {
  if (
    !input ||
    !UUID_PATTERN.test(input.authSubject) ||
    !UUID_PATTERN.test(input.householdId) ||
    !UUID_PATTERN.test(input.clientId)
  ) {
    throw new MutationDeliveryError(
      "MUTATION_DELIVERY_INVALID_INPUT",
      "authSubject, householdId and clientId must be valid UUIDs.",
    );
  }

  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new MutationDeliveryError(
      "MUTATION_DELIVERY_INVALID_INPUT",
      "limit must be an integer between 1 and 100.",
    );
  }
  return limit;
}

function validateAdapters(
  adapters: readonly MutationDeliveryAdapter[],
): Map<string, MutationDeliveryAdapter> {
  const map = new Map<string, MutationDeliveryAdapter>();

  for (const adapter of adapters) {
    if (
      !adapter ||
      typeof adapter.moduleKey !== "string" ||
      adapter.moduleKey.trim().length === 0 ||
      typeof adapter.entityType !== "string" ||
      adapter.entityType.trim().length === 0 ||
      !Array.isArray(adapter.operations) ||
      adapter.operations.length === 0 ||
      adapter.operations.some(
        (operation) =>
          typeof operation !== "string" || operation.trim().length === 0,
      ) ||
      typeof adapter.submit !== "function"
    ) {
      throw new MutationDeliveryError(
        "MUTATION_DELIVERY_INVALID_ADAPTER",
        "Mutation delivery adapters must declare module, entity, operations and submit().",
      );
    }

    for (const operation of adapter.operations) {
      const key = JSON.stringify([
        adapter.moduleKey,
        adapter.entityType,
        operation,
      ]);
      if (map.has(key)) {
        throw new MutationDeliveryError(
          "MUTATION_DELIVERY_DUPLICATE_ADAPTER",
          "Only one mutation delivery adapter may own a module/entity/operation tuple.",
        );
      }
      map.set(key, adapter);
    }
  }

  return map;
}

function findAdapter(
  adapters: Map<string, MutationDeliveryAdapter>,
  mutation: QueuedMutation,
): MutationDeliveryAdapter | null {
  return (
    adapters.get(
      JSON.stringify([
        mutation.moduleKey,
        mutation.entityType,
        mutation.operation,
      ]),
    ) ?? null
  );
}

function cancellation(
  message = "Mutation delivery was cancelled.",
): MutationDeliveryStop {
  return Object.freeze({
    code: "MUTATION_DELIVERY_CANCELLED",
    message,
    status: null,
    requestId: null,
  });
}

function failure(error: unknown): MutationDeliveryStop {
  const source = typeof error === "object" && error !== null ? error : {};
  return Object.freeze({
    code:
      "code" in source && typeof source.code === "string"
        ? source.code
        : "MUTATION_DELIVERY_FAILED",
    message:
      "message" in source && typeof source.message === "string"
        ? source.message
        : "Mutation delivery failed.",
    status:
      "status" in source && typeof source.status === "number"
        ? source.status
        : null,
    requestId:
      "requestId" in source && typeof source.requestId === "string"
        ? source.requestId
        : null,
  });
}

function snapshot(
  result: MutationSubmissionResult,
): MutationResultSnapshot {
  return {
    serverRevision: result.serverRevision,
    changeSequence: result.changeSequence,
    errorCode: result.errorCode,
    serverState: result.serverState,
  };
}

function terminalSubmissionError(code: string, status?: number | null): boolean {
  return (
    code === "MUTATION_SUBMISSION_INVALID_INPUT" ||
    code === "MUTATION_ID_REUSED" ||
    code === "MUTATION_ID_UNVERIFIABLE" ||
    code.endsWith("_INVALID_INPUT") ||
    code.endsWith("_NOT_FOUND") ||
    code.endsWith("_INVALID_RESPONSE") ||
    code.includes("TRANSACTION_NOT_FOUND") ||
    code.includes("RECURRING_SOURCE_INVALID") ||
    (typeof status === "number" &&
      status >= 400 &&
      status < 500 &&
      status !== 408 &&
      status !== 429)
  );
}

// Delivers one bounded queue batch in durable queue order. Applied mutations stay
// stored as terminal "applied" rows until later pull/cache reconciliation proves
// their change sequence has been safely applied locally.
export async function deliverQueuedMutationBatch(
  dependencies: MutationDeliveryDependencies,
  input: MutationDeliveryInput,
  signal?: AbortSignal,
): Promise<MutationDeliverySummary> {
  const limit = validateInput(input);
  const adapters = validateAdapters(dependencies.adapters);
  const queued = await getQueuedMutations(
    input.authSubject,
    input.householdId,
    limit,
  );

  let attempted = 0;
  let applied = 0;
  let conflicts = 0;
  let rejected = 0;
  let deferred = 0;
  let stop: MutationDeliveryStop | null = null;

  for (const mutation of queued) {
    if (signal?.aborted) {
      stop = cancellation();
      break;
    }

    const adapter = findAdapter(adapters, mutation);
    if (!adapter) {
      await returnMutationToQueue(
        input.authSubject,
        mutation.clientMutationId,
        "MUTATION_DELIVERY_UNSUPPORTED_QUEUE_ITEM",
      );
      deferred += 1;
      stop = Object.freeze({
        code: "MUTATION_DELIVERY_UNSUPPORTED_QUEUE_ITEM",
        message:
          "The queued mutation requires a delivery adapter that is not available.",
        status: null,
        requestId: null,
      });
      break;
    }

    await markMutationSending(
      input.authSubject,
      mutation.clientMutationId,
    );
    attempted += 1;

    let result: MutationSubmissionResult;
    try {
      signal?.throwIfAborted();
      result = await adapter.submit(
        mutation,
        input.clientId,
        signal,
      );
    } catch (error) {
      const detail = signal?.aborted ? cancellation() : failure(error);
      if (terminalSubmissionError(detail.code, detail.status) || mutation.attempts >= 3) {
        await markMutationRejected(
          input.authSubject,
          mutation.clientMutationId,
          {
            serverRevision: null,
            changeSequence: null,
            errorCode: detail.code,
            serverState: null,
          },
        );
        rejected += 1;
        continue;
      } else {
        await returnMutationToQueue(
          input.authSubject,
          mutation.clientMutationId,
          detail.code,
        );
        deferred += 1;
        stop = detail;
        break;
      }
    }

    if (result.clientMutationId !== mutation.clientMutationId) {
      await returnMutationToQueue(
        input.authSubject,
        mutation.clientMutationId,
        "MUTATION_DELIVERY_IDENTITY_MISMATCH",
      );
      deferred += 1;
      stop = Object.freeze({
        code: "MUTATION_DELIVERY_IDENTITY_MISMATCH",
        message:
          "The mutation adapter returned a result for a different mutation identity.",
        status: null,
        requestId: null,
      });
      break;
    }

    const durableResult = snapshot(result);
    if (result.status === "applied") {
      await markMutationApplied(
        input.authSubject,
        mutation.clientMutationId,
        durableResult,
      );
      applied += 1;
    } else if (result.status === "conflict") {
      await markMutationConflict(
        input.authSubject,
        mutation.clientMutationId,
        durableResult,
      );
      conflicts += 1;
      stop = Object.freeze({
        code: result.errorCode ?? "MUTATION_CONFLICT",
        message: "Mutation delivery stopped at a conflict.",
        status: null,
        requestId: null,
      });
      break;
    } else if (result.status === "rejected") {
      await markMutationRejected(
        input.authSubject,
        mutation.clientMutationId,
        durableResult,
      );
      rejected += 1;
      // Do not stop delivery: continue delivering subsequent queued mutations in this batch
      // so a rejected mutation does not cause a Head-of-Line block for independent mutations.
    } else {
      await returnMutationToQueue(
        input.authSubject,
        mutation.clientMutationId,
        "MUTATION_RECEIVED_PENDING",
      );
      deferred += 1;
      stop = Object.freeze({
        code: "MUTATION_RECEIVED_PENDING",
        message:
          "The server has not produced a terminal mutation result yet.",
        status: null,
        requestId: null,
      });
      break;
    }

    if (signal?.aborted) {
      stop = cancellation(
        "Mutation delivery was cancelled after recording a known server result.",
      );
      break;
    }
  }

  return Object.freeze({
    attempted,
    applied,
    conflicts,
    rejected,
    deferred,
    stop,
  });
}
