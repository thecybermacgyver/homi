import type {
  HomiModuleMutationAdapter,
  HomiModuleMutationSubmissionResult,
  HomiModuleQueuedMutation,
  HomiModuleSyncChange,
  HomiModuleSyncChangeHandler,
  HomiModuleSyncHandlerContext,
} from "@homi/module-sdk";
import { CHEQUEBOOK_MODULE_KEY } from "./constants.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE = /^[1-9][0-9]*$/;
const NON_NEGATIVE = /^(0|[1-9][0-9]*)$/;

const OPERATIONS: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  account: Object.freeze(["create", "update", "delete"]),
  transaction: Object.freeze([
    "create",
    "update",
    "delete",
  ]),
  "recurring-rule": Object.freeze([
    "create",
    "update",
    "delete",
  ]),
  category: Object.freeze([
    "create",
    "update",
    "delete",
  ]),
  "budget-limit": Object.freeze([
    "create",
    "update",
    "delete",
  ]),
  "chequebook-settings": Object.freeze(["update"]),
});

const PATHS: Readonly<Record<string, string>> =
  Object.freeze({
    account: "/api/v1/modules/chequebook/accounts",
    transaction:
      "/api/v1/modules/chequebook/transactions",
    "recurring-rule":
      "/api/v1/modules/chequebook/recurring-rules",
    category:
      "/api/v1/modules/chequebook/categories",
    "budget-limit":
      "/api/v1/modules/chequebook/budget-limits",
    "chequebook-settings":
      "/api/v1/modules/chequebook/settings",
  });

export class ChequebookWebApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly requestId?: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "ChequebookWebApiError";
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

async function readJson(
  response: Response,
): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ChequebookWebApiError(
      "CHEQUEBOOK_API_INVALID_RESPONSE",
      "Chequebook returned an invalid JSON response.",
      response.status,
      undefined,
      { cause },
    );
  }
}

function responseError(
  body: unknown,
  status: number,
): ChequebookWebApiError {
  if (
    isObject(body) &&
    isObject(body.error) &&
    typeof body.error.code === "string" &&
    typeof body.error.message === "string"
  ) {
    return new ChequebookWebApiError(
      body.error.code,
      body.error.message,
      status,
      typeof body.error.requestId === "string"
        ? body.error.requestId
        : undefined,
    );
  }
  return new ChequebookWebApiError(
    "CHEQUEBOOK_API_FAILED",
    "The Chequebook request failed.",
    status,
  );
}

function parseMutationResult(
  body: unknown,
  clientMutationId: string,
): HomiModuleMutationSubmissionResult {
  if (!isObject(body) || !isObject(body.data)) {
    throw new ChequebookWebApiError(
      "CHEQUEBOOK_MUTATION_INVALID_RESPONSE",
      "The Chequebook mutation response is invalid.",
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
        POSITIVE.test(data.serverRevision))
    ) ||
    !(
      data.changeSequence === null ||
      (typeof data.changeSequence === "string" &&
        NON_NEGATIVE.test(data.changeSequence))
    ) ||
    !(
      data.errorCode === null ||
      typeof data.errorCode === "string"
    ) ||
    typeof data.replayed !== "boolean"
  ) {
    throw new ChequebookWebApiError(
      "CHEQUEBOOK_MUTATION_INVALID_RESPONSE",
      "The Chequebook mutation response data is invalid.",
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

function parseSnapshot(
  entityType: string,
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (!isObject(value)) {
    throw new ChequebookWebApiError(
      "CHEQUEBOOK_ENTITY_INVALID_RESPONSE",
      "The Chequebook entity response is invalid.",
    );
  }

  if (entityType === "chequebook-settings") {
    if (
      typeof value.householdId !== "string" ||
      !UUID.test(value.householdId) ||
      typeof value.revision !== "string" ||
      !POSITIVE.test(value.revision) ||
      typeof value.currency !== "string" ||
      typeof value.defaultAccountId !== "string" ||
      !UUID.test(value.defaultAccountId)
    ) {
      throw new ChequebookWebApiError(
        "CHEQUEBOOK_SETTINGS_INVALID_RESPONSE",
        "The Chequebook settings response is invalid.",
      );
    }
    return Object.freeze({ ...value });
  }

  if (
    typeof value.id !== "string" ||
    !UUID.test(value.id) ||
    typeof value.revision !== "string" ||
    !POSITIVE.test(value.revision)
  ) {
    throw new ChequebookWebApiError(
      "CHEQUEBOOK_ENTITY_INVALID_RESPONSE",
      "The Chequebook entity identity is invalid.",
    );
  }

  return Object.freeze({ ...value });
}

async function submitMutation(
  mutation: HomiModuleQueuedMutation,
  clientId: string,
  signal?: AbortSignal,
): Promise<HomiModuleMutationSubmissionResult> {
  if (
    mutation.moduleKey !== CHEQUEBOOK_MODULE_KEY ||
    !OPERATIONS[mutation.entityType]?.includes(
      mutation.operation,
    ) ||
    !UUID.test(mutation.householdId) ||
    !UUID.test(mutation.entityId) ||
    !UUID.test(mutation.clientMutationId) ||
    !UUID.test(clientId) ||
    !NON_NEGATIVE.test(mutation.baseRevision)
  ) {
    throw new ChequebookWebApiError(
      "CHEQUEBOOK_MUTATION_INVALID_INPUT",
      "The queued Chequebook mutation is invalid.",
    );
  }

  const response = await fetch(
    "/api/v1/core/sync/mutations",
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Homi-Household-ID":
          mutation.householdId,
        "X-Homi-Client-ID": clientId,
      },
      body: JSON.stringify({
        clientMutationId:
          mutation.clientMutationId,
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
    throw responseError(body, response.status);
  }
  return parseMutationResult(
    body,
    mutation.clientMutationId,
  );
}

async function fetchSnapshot(
  change: HomiModuleSyncChange,
  context: HomiModuleSyncHandlerContext,
  signal?: AbortSignal,
): Promise<Readonly<Record<string, unknown>>> {
  const base = PATHS[change.entityType];
  if (!base) {
    throw new ChequebookWebApiError(
      "CHEQUEBOOK_CHANGE_INVALID",
      "The Chequebook change entity is unsupported.",
    );
  }

  const url =
    change.entityType === "chequebook-settings"
      ? base
      : `${base}/${encodeURIComponent(
          change.entityId,
        )}`;

  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "X-Homi-Household-ID":
        context.householdId,
      "X-Homi-Client-ID": context.clientId,
    },
    ...(signal ? { signal } : {}),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw responseError(body, response.status);
  }
  if (!isObject(body) || !Object.hasOwn(body, "data")) {
    throw new ChequebookWebApiError(
      "CHEQUEBOOK_ENTITY_INVALID_RESPONSE",
      "The Chequebook entity response shape is invalid.",
    );
  }

  const snapshot = parseSnapshot(
    change.entityType,
    body.data,
  );
  const revision = snapshot.revision;
  if (
    typeof revision !== "string" ||
    BigInt(revision) < BigInt(change.revision)
  ) {
    throw new ChequebookWebApiError(
      "CHEQUEBOOK_ENTITY_STALE_RESPONSE",
      "The Chequebook entity snapshot is stale.",
    );
  }

  if (
    change.entityType ===
    "chequebook-settings"
  ) {
    if (
      snapshot.householdId !==
      change.entityId
    ) {
      throw new ChequebookWebApiError(
        "CHEQUEBOOK_ENTITY_INVALID_RESPONSE",
        "The Chequebook settings identity is invalid.",
      );
    }
  } else if (snapshot.id !== change.entityId) {
    throw new ChequebookWebApiError(
      "CHEQUEBOOK_ENTITY_INVALID_RESPONSE",
      "The Chequebook entity identity does not match the change.",
    );
  }

  return snapshot;
}

function adapter(
  entityType: string,
): HomiModuleMutationAdapter {
  return Object.freeze({
    moduleKey: CHEQUEBOOK_MODULE_KEY,
    entityType,
    operations: OPERATIONS[entityType]!,
    submit: submitMutation,
  });
}

function handler(
  entityType: string,
): HomiModuleSyncChangeHandler {
  return Object.freeze({
    moduleKey: CHEQUEBOOK_MODULE_KEY,
    entityType,
    async materialize(
      change: HomiModuleSyncChange,
      context: HomiModuleSyncHandlerContext,
      signal?: AbortSignal,
    ) {
      if (
        change.moduleKey !==
          CHEQUEBOOK_MODULE_KEY ||
        change.entityType !== entityType ||
        change.householdId !==
          context.householdId
      ) {
        throw new ChequebookWebApiError(
          "CHEQUEBOOK_CHANGE_INVALID",
          "The Chequebook change does not match the active household.",
        );
      }

      if (change.operation === "delete") {
        return Object.freeze({
          kind: "delete" as const,
          moduleKey:
            CHEQUEBOOK_MODULE_KEY,
          entityType,
          entityId: change.entityId,
          sequence: change.sequence,
        });
      }

      if (
        change.operation !== "create" &&
        change.operation !== "update"
      ) {
        throw new ChequebookWebApiError(
          "CHEQUEBOOK_CHANGE_INVALID",
          "The Chequebook change operation is unsupported.",
        );
      }

      const snapshot = await fetchSnapshot(
        change,
        context,
        signal,
      );

      return Object.freeze({
        kind: "put" as const,
        moduleKey: CHEQUEBOOK_MODULE_KEY,
        entityType,
        entityId: change.entityId,
        revision: String(snapshot.revision),
        sequence: change.sequence,
        data: snapshot,
      });
    },
  });
}

export const chequebookMutationAdapters =
  Object.freeze(
    Object.keys(OPERATIONS).map(adapter),
  );

export const chequebookChangeHandlers =
  Object.freeze(
    Object.keys(OPERATIONS).map(handler),
  );
