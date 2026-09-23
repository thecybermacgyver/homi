import type {
  HomiModuleMutationAdapter,
  HomiModuleMutationSubmissionResult,
  HomiModuleQueuedMutation,
  HomiModuleSyncChange,
  HomiModuleSyncChangeHandler,
  HomiModuleSyncHandlerContext,
} from "@homi/module-sdk";
import { STARTER_MODULE_KEY } from "./constants.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
const NON_NEGATIVE_INTEGER = /^(0|[1-9][0-9]*)$/;

export interface StarterItemSnapshot {
  readonly id: string;
  readonly title: string;
  readonly revision: string;
  readonly deleted: boolean;
}

class StarterWebApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly requestId?: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "StarterWebApiError";
  }
}

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function parseError(
  body: unknown,
  status: number,
): StarterWebApiError {
  if (
    isObject(body) &&
    isObject(body.error) &&
    typeof body.error.code === "string" &&
    typeof body.error.message === "string"
  ) {
    return new StarterWebApiError(
      body.error.code,
      body.error.message,
      status,
      typeof body.error.requestId === "string"
        ? body.error.requestId
        : undefined,
    );
  }

  return new StarterWebApiError(
    "STARTER_API_FAILED",
    "The Starter request failed.",
    status,
  );
}

async function readJson(
  response: Response,
): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new StarterWebApiError(
      "STARTER_API_INVALID_RESPONSE",
      "The Starter response was not valid JSON.",
      response.status,
      undefined,
      { cause },
    );
  }
}

function parseMutationResult(
  body: unknown,
  clientMutationId: string,
): HomiModuleMutationSubmissionResult {
  if (
    !isObject(body) ||
    !exactKeys(body, ["data"]) ||
    !isObject(body.data) ||
    !exactKeys(body.data, [
      "clientMutationId",
      "status",
      "serverRevision",
      "changeSequence",
      "errorCode",
      "serverState",
      "replayed",
    ])
  ) {
    throw new StarterWebApiError(
      "STARTER_MUTATION_INVALID_RESPONSE",
      "The mutation response shape is invalid.",
    );
  }

  const data = body.data;
  if (
    data.clientMutationId !== clientMutationId ||
    (data.status !== "received" &&
      data.status !== "applied" &&
      data.status !== "conflict" &&
      data.status !== "rejected") ||
    !(
      data.serverRevision === null ||
      (typeof data.serverRevision === "string" &&
        POSITIVE_INTEGER.test(data.serverRevision))
    ) ||
    !(
      data.changeSequence === null ||
      (typeof data.changeSequence === "string" &&
        NON_NEGATIVE_INTEGER.test(data.changeSequence))
    ) ||
    !(
      data.errorCode === null ||
      typeof data.errorCode === "string"
    ) ||
    typeof data.replayed !== "boolean"
  ) {
    throw new StarterWebApiError(
      "STARTER_MUTATION_INVALID_RESPONSE",
      "The mutation response data is invalid.",
    );
  }

  return Object.freeze({
    clientMutationId: data.clientMutationId,
    status: data.status,
    serverRevision: data.serverRevision,
    changeSequence: data.changeSequence,
    errorCode: data.errorCode,
    serverState: data.serverState,
    replayed: data.replayed,
  });
}

function parseItemSnapshot(
  value: unknown,
): StarterItemSnapshot {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      "id",
      "title",
      "revision",
      "deleted",
    ]) ||
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    typeof value.title !== "string" ||
    value.title.length < 1 ||
    typeof value.revision !== "string" ||
    !POSITIVE_INTEGER.test(value.revision) ||
    typeof value.deleted !== "boolean"
  ) {
    throw new StarterWebApiError(
      "STARTER_ITEM_INVALID_RESPONSE",
      "The Starter item response is invalid.",
    );
  }

  return Object.freeze({
    id: value.id,
    title: value.title,
    revision: value.revision,
    deleted: value.deleted,
  });
}

async function submitItemMutation(
  mutation: HomiModuleQueuedMutation,
  clientId: string,
  signal?: AbortSignal,
): Promise<HomiModuleMutationSubmissionResult> {
  if (
    mutation.moduleKey !== STARTER_MODULE_KEY ||
    mutation.entityType !== "item" ||
    !["create", "update", "delete"].includes(
      mutation.operation,
    ) ||
    !UUID_PATTERN.test(mutation.householdId) ||
    !UUID_PATTERN.test(mutation.entityId) ||
    !UUID_PATTERN.test(mutation.clientMutationId) ||
    !UUID_PATTERN.test(clientId) ||
    !NON_NEGATIVE_INTEGER.test(mutation.baseRevision)
  ) {
    throw new StarterWebApiError(
      "STARTER_MUTATION_INVALID_INPUT",
      "The queued Starter mutation is invalid.",
    );
  }

  const response = await fetch(
    "/api/v1/core/sync/mutations",
    {
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
    },
  );

  const body = await readJson(response);
  if (!response.ok) {
    throw parseError(body, response.status);
  }

  return parseMutationResult(
    body,
    mutation.clientMutationId,
  );
}

async function fetchItem(
  change: HomiModuleSyncChange,
  context: HomiModuleSyncHandlerContext,
  signal?: AbortSignal,
): Promise<StarterItemSnapshot> {
  const response = await fetch(
    `/api/v1/modules/starter/items/${encodeURIComponent(
      change.entityId,
    )}`,
    {
      method: "GET",
      credentials: "same-origin",
      headers: {
        "X-Homi-Household-ID": context.householdId,
        "X-Homi-Client-ID": context.clientId,
      },
      ...(signal ? { signal } : {}),
    },
  );

  const body = await readJson(response);
  if (!response.ok) {
    throw parseError(body, response.status);
  }

  if (
    !isObject(body) ||
    !exactKeys(body, ["data"])
  ) {
    throw new StarterWebApiError(
      "STARTER_ITEM_INVALID_RESPONSE",
      "The Starter item response shape is invalid.",
    );
  }

  const item = parseItemSnapshot(body.data);
  if (
    item.id !== change.entityId ||
    BigInt(item.revision) < BigInt(change.revision)
  ) {
    throw new StarterWebApiError(
      "STARTER_ITEM_STALE_RESPONSE",
      "The Starter item snapshot is older than the sync change.",
    );
  }

  return item;
}

export const starterItemMutationAdapter:
  HomiModuleMutationAdapter = Object.freeze({
    moduleKey: STARTER_MODULE_KEY,
    entityType: "item",
    operations: Object.freeze([
      "create",
      "update",
      "delete",
    ]),
    submit: submitItemMutation,
  });

export const starterItemChangeHandler:
  HomiModuleSyncChangeHandler = Object.freeze({
    moduleKey: STARTER_MODULE_KEY,
    entityType: "item",
    async materialize(
      change: HomiModuleSyncChange,
      context: HomiModuleSyncHandlerContext,
      signal?: AbortSignal,
    ) {
      if (
        change.moduleKey !== STARTER_MODULE_KEY ||
        change.entityType !== "item" ||
        change.householdId !== context.householdId
      ) {
        throw new StarterWebApiError(
          "STARTER_CHANGE_INVALID",
          "The Starter sync change does not match the active module context.",
        );
      }

      if (change.operation === "delete") {
        return Object.freeze({
          kind: "delete" as const,
          moduleKey: STARTER_MODULE_KEY,
          entityType: "item",
          entityId: change.entityId,
          sequence: change.sequence,
        });
      }

      if (
        change.operation !== "create" &&
        change.operation !== "update"
      ) {
        throw new StarterWebApiError(
          "STARTER_CHANGE_INVALID",
          "The Starter sync operation is unsupported.",
        );
      }

      const item = await fetchItem(
        change,
        context,
        signal,
      );

      return Object.freeze({
        kind: "put" as const,
        moduleKey: STARTER_MODULE_KEY,
        entityType: "item",
        entityId: change.entityId,
        revision: item.revision,
        sequence: change.sequence,
        data: item,
      });
    },
  });
