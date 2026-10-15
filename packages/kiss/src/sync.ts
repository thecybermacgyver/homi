import type {
  HomiModuleMutationAdapter,
  HomiModuleMutationSubmissionResult,
  HomiModuleQueuedMutation,
  HomiModuleSyncChange,
  HomiModuleSyncChangeHandler,
  HomiModuleSyncHandlerContext,
} from "@homi/module-sdk";
import { ENTITY_TYPES, KISS_MODULE_KEY, type EntityType } from "./constants.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
const NON_NEGATIVE_INTEGER = /^(0|[1-9][0-9]*)$/;

class KissApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number) {
    super(message);
    this.name = "KissApiError";
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function json(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text());
  } catch {
    throw new KissApiError("KISS_API_INVALID_RESPONSE", "K.I.S.S. returned an invalid response.", response.status);
  }
}

function responseError(body: unknown, status: number): KissApiError {
  if (object(body) && object(body.error) && typeof body.error.code === "string" && typeof body.error.message === "string") {
    return new KissApiError(body.error.code, body.error.message, status);
  }
  return new KissApiError("KISS_API_FAILED", "The K.I.S.S. request failed.", status);
}

function parseMutationResult(body: unknown, clientMutationId: string): HomiModuleMutationSubmissionResult {
  if (!object(body) || !object(body.data)) {
    throw new KissApiError("KISS_MUTATION_INVALID_RESPONSE", "The mutation response is invalid.");
  }
  const data = body.data;
  if (
    data.clientMutationId !== clientMutationId ||
    !["received", "applied", "conflict", "rejected"].includes(String(data.status)) ||
    !(data.serverRevision === null || (typeof data.serverRevision === "string" && POSITIVE_INTEGER.test(data.serverRevision))) ||
    !(data.changeSequence === null || (typeof data.changeSequence === "string" && NON_NEGATIVE_INTEGER.test(data.changeSequence))) ||
    !(data.errorCode === null || typeof data.errorCode === "string") ||
    typeof data.replayed !== "boolean"
  ) {
    throw new KissApiError("KISS_MUTATION_INVALID_RESPONSE", "The mutation response data is invalid.");
  }
  return Object.freeze({
    clientMutationId,
    status: data.status as HomiModuleMutationSubmissionResult["status"],
    serverRevision: data.serverRevision,
    changeSequence: data.changeSequence,
    errorCode: data.errorCode,
    serverState: data.serverState,
    replayed: data.replayed,
  });
}

function adapterFor(entityType: EntityType, operations: readonly string[]): HomiModuleMutationAdapter {
  return Object.freeze({
    moduleKey: KISS_MODULE_KEY,
    entityType,
    operations: Object.freeze([...operations]),
    async submit(mutation: HomiModuleQueuedMutation, clientId: string, signal?: AbortSignal) {
      if (
        mutation.moduleKey !== KISS_MODULE_KEY || mutation.entityType !== entityType ||
        !operations.includes(mutation.operation) || !UUID.test(mutation.householdId) ||
        !UUID.test(mutation.entityId) || !UUID.test(mutation.clientMutationId) || !UUID.test(clientId) ||
        !NON_NEGATIVE_INTEGER.test(mutation.baseRevision)
      ) {
        throw new KissApiError("KISS_MUTATION_INVALID_INPUT", "The queued K.I.S.S. mutation is invalid.");
      }
      const response = await fetch("/api/v1/core/sync/mutations", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Homi-Household-ID": mutation.householdId, "X-Homi-Client-ID": clientId },
        body: JSON.stringify({
          clientMutationId: mutation.clientMutationId,
          moduleKey: mutation.moduleKey,
          entityType: mutation.entityType,
          entityId: mutation.entityId,
          operation: mutation.operation,
          baseRevision: mutation.baseRevision,
          payload: mutation.payload,
        }),
        ...(signal ? { signal } : {}),
      });
      const body = await json(response);
      if (!response.ok) throw responseError(body, response.status);
      return parseMutationResult(body, mutation.clientMutationId);
    },
  });
}

function handlerFor(entityType: EntityType): HomiModuleSyncChangeHandler {
  return Object.freeze({
    moduleKey: KISS_MODULE_KEY,
    entityType,
    async materialize(change: HomiModuleSyncChange, context: HomiModuleSyncHandlerContext, signal?: AbortSignal) {
      if (change.moduleKey !== KISS_MODULE_KEY || change.entityType !== entityType || change.householdId !== context.householdId) {
        throw new KissApiError("KISS_CHANGE_INVALID", "The K.I.S.S. sync change is invalid.");
      }
      const drop = () => Object.freeze({
        kind: "delete" as const, moduleKey: KISS_MODULE_KEY, entityType, entityId: change.entityId, sequence: change.sequence,
      });
      if (change.operation === "delete") return drop();
      const response = await fetch(
        `/api/v1/modules/kiss/entity/${entityType}/${encodeURIComponent(change.entityId)}`,
        {
          credentials: "same-origin",
          headers: { "X-Homi-Household-ID": context.householdId, "X-Homi-Client-ID": context.clientId },
          ...(signal ? { signal } : {}),
        },
      );
      // Another member's private item is simply not shown to this device.
      if (response.status === 404) return drop();
      const body = await json(response);
      if (!response.ok) throw responseError(body, response.status);
      if (!object(body) || !object(body.data) || typeof body.data.id !== "string" || typeof body.data.revision !== "string") {
        throw new KissApiError("KISS_ENTITY_INVALID_RESPONSE", "The K.I.S.S. response is invalid.");
      }
      return Object.freeze({
        kind: "put" as const,
        moduleKey: KISS_MODULE_KEY,
        entityType,
        entityId: body.data.id,
        revision: body.data.revision,
        sequence: change.sequence,
        data: body.data,
      });
    },
  });
}

const OPS: Record<EntityType, readonly string[]> = {
  partnership: ["create", "update", "delete"],
  answer: ["create", "update", "delete"],
  checkin: ["create", "update"],
  note: ["create", "update", "delete"],
  date: ["create", "update", "delete"],
  quiz: ["create", "update"],
  swipe: ["create", "update"],
};

export const mutationAdapters = ENTITY_TYPES.map((t) => adapterFor(t, OPS[t]));
export const changeHandlers = ENTITY_TYPES.map(handlerFor);
