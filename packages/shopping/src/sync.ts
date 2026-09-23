import type {
  HomiModuleMutationAdapter,
  HomiModuleMutationSubmissionResult,
  HomiModuleQueuedMutation,
  HomiModuleSyncChange,
  HomiModuleSyncChangeHandler,
  HomiModuleSyncHandlerContext,
} from "@homi/module-sdk";
import { SHOPPING_MODULE_KEY } from "./constants.js";
import type { ShoppingItem } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
const NON_NEGATIVE_INTEGER = /^(0|[1-9][0-9]*)$/;

class ShoppingApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ShoppingApiError";
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function json(response: Response): Promise<unknown> {
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new ShoppingApiError(
      "SHOPPING_API_INVALID_RESPONSE",
      "Shopping returned an invalid response.",
      response.status,
    );
  }
}

function responseError(body: unknown, status: number): ShoppingApiError {
  if (
    object(body) &&
    object(body.error) &&
    typeof body.error.code === "string" &&
    typeof body.error.message === "string"
  ) {
    return new ShoppingApiError(body.error.code, body.error.message, status);
  }
  return new ShoppingApiError("SHOPPING_API_FAILED", "The Shopping request failed.", status);
}

export function parseShoppingItem(value: unknown): ShoppingItem {
  if (
    !object(value) ||
    typeof value.id !== "string" ||
    !UUID.test(value.id) ||
    typeof value.name !== "string" ||
    typeof value.quantity !== "string" ||
    typeof value.store !== "string" ||
    typeof value.aisle !== "string" ||
    !(value.assignedTo === null || (typeof value.assignedTo === "string" && UUID.test(value.assignedTo))) ||
    typeof value.checked !== "boolean" ||
    !(value.checkedBy === null || (typeof value.checkedBy === "string" && UUID.test(value.checkedBy))) ||
    !(value.checkedAt === null || typeof value.checkedAt === "string") ||
    typeof value.revision !== "string" ||
    !POSITIVE_INTEGER.test(value.revision) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.deleted !== "boolean"
  ) {
    throw new ShoppingApiError("SHOPPING_ITEM_INVALID_RESPONSE", "A Shopping item response is invalid.");
  }
  return Object.freeze({
    id: value.id,
    name: value.name,
    quantity: value.quantity,
    store: value.store,
    aisle: value.aisle,
    assignedTo: value.assignedTo,
    checked: value.checked,
    checkedBy: value.checkedBy,
    checkedAt: value.checkedAt,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    deleted: value.deleted,
  });
}

function parseMutationResult(
  body: unknown,
  clientMutationId: string,
): HomiModuleMutationSubmissionResult {
  if (!object(body) || !object(body.data)) {
    throw new ShoppingApiError("SHOPPING_MUTATION_INVALID_RESPONSE", "The mutation response is invalid.");
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
    throw new ShoppingApiError("SHOPPING_MUTATION_INVALID_RESPONSE", "The mutation response data is invalid.");
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

async function submit(
  mutation: HomiModuleQueuedMutation,
  clientId: string,
  signal?: AbortSignal,
): Promise<HomiModuleMutationSubmissionResult> {
  if (
    mutation.moduleKey !== SHOPPING_MODULE_KEY ||
    mutation.entityType !== "item" ||
    !["create", "update", "delete"].includes(mutation.operation) ||
    !UUID.test(mutation.householdId) ||
    !UUID.test(mutation.entityId) ||
    !UUID.test(mutation.clientMutationId) ||
    !UUID.test(clientId) ||
    !NON_NEGATIVE_INTEGER.test(mutation.baseRevision)
  ) {
    throw new ShoppingApiError("SHOPPING_MUTATION_INVALID_INPUT", "The queued Shopping mutation is invalid.");
  }
  const response = await fetch("/api/v1/core/sync/mutations", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Homi-Household-ID": mutation.householdId,
      "X-Homi-Client-ID": clientId,
    },
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
}

async function fetchItem(
  change: HomiModuleSyncChange,
  context: HomiModuleSyncHandlerContext,
  signal?: AbortSignal,
): Promise<ShoppingItem> {
  const response = await fetch(
    `/api/v1/modules/shopping/items/${encodeURIComponent(change.entityId)}`,
    {
      credentials: "same-origin",
      headers: {
        "X-Homi-Household-ID": context.householdId,
        "X-Homi-Client-ID": context.clientId,
      },
      ...(signal ? { signal } : {}),
    },
  );
  const body = await json(response);
  if (!response.ok) throw responseError(body, response.status);
  if (!object(body) || !Object.hasOwn(body, "data")) {
    throw new ShoppingApiError("SHOPPING_ITEM_INVALID_RESPONSE", "The Shopping item response shape is invalid.");
  }
  const item = parseShoppingItem(body.data);
  if (item.id !== change.entityId || BigInt(item.revision) < BigInt(change.revision)) {
    throw new ShoppingApiError("SHOPPING_ITEM_STALE_RESPONSE", "The Shopping item response is stale.");
  }
  return item;
}

export const shoppingItemMutationAdapter: HomiModuleMutationAdapter =
  Object.freeze({
    moduleKey: SHOPPING_MODULE_KEY,
    entityType: "item",
    operations: Object.freeze(["create", "update", "delete"]),
    submit,
  });

export const shoppingItemChangeHandler: HomiModuleSyncChangeHandler =
  Object.freeze({
    moduleKey: SHOPPING_MODULE_KEY,
    entityType: "item",
    async materialize(
      change: HomiModuleSyncChange,
      context: HomiModuleSyncHandlerContext,
      signal?: AbortSignal,
    ) {
      if (
        change.moduleKey !== SHOPPING_MODULE_KEY ||
        change.entityType !== "item" ||
        change.householdId !== context.householdId
      ) {
        throw new ShoppingApiError("SHOPPING_CHANGE_INVALID", "The Shopping sync change is invalid.");
      }
      if (change.operation === "delete") {
        return Object.freeze({
          kind: "delete" as const,
          moduleKey: SHOPPING_MODULE_KEY,
          entityType: "item",
          entityId: change.entityId,
          sequence: change.sequence,
        });
      }
      if (change.operation !== "create" && change.operation !== "update") {
        throw new ShoppingApiError("SHOPPING_CHANGE_INVALID", "The Shopping sync operation is invalid.");
      }
      const item = await fetchItem(change, context, signal);
      return Object.freeze({
        kind: "put" as const,
        moduleKey: SHOPPING_MODULE_KEY,
        entityType: "item",
        entityId: item.id,
        revision: item.revision,
        sequence: change.sequence,
        data: item,
      });
    },
  });
