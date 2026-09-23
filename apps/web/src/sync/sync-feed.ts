const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NON_NEGATIVE = /^(0|[1-9][0-9]*)$/;
const POSITIVE = /^[1-9][0-9]*$/;

export interface SyncChange {
  readonly sequence: string;
  readonly householdId: string;
  readonly moduleKey: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: string;
  readonly revision: string;
  readonly changedByUserId: string | null;
  readonly clientId: string | null;
  readonly changedAt: string;
}

export interface SyncChangePage {
  readonly changes: readonly SyncChange[];
  readonly nextSequence: string;
  readonly hasMore: boolean;
}

export interface SyncCursorStatus {
  readonly clientId: string;
  readonly householdId: string;
  readonly lastChangeSequence: string;
  readonly latestChangeSequence: string;
}

export class SyncFeedError extends Error {
  readonly status: number | undefined;
  readonly requestId: string | undefined;

  constructor(
    public readonly code: string,
    message: string,
    options: ErrorOptions & { status?: number; requestId?: string } = {},
  ) {
    super(message, options);
    this.name = "SyncFeedError";
    this.status = options.status;
    this.requestId = options.requestId;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  try {
    return new Date(time).toISOString() === value;
  } catch {
    return false;
  }
}

function invalidInput(message: string): never {
  throw new SyncFeedError("SYNC_FEED_INVALID_INPUT", message);
}

function validateIdentity(householdId: string, clientId: string): void {
  if (!isUuid(householdId) || !isUuid(clientId)) {
    invalidInput("householdId and clientId must be valid UUIDs.");
  }
}

function compareDecimal(left: string, right: string): number {
  const a = left.replace(/^0+(?=\d)/, "");
  const b = right.replace(/^0+(?=\d)/, "");
  return a.length === b.length ? a.localeCompare(b) : a.length - b.length;
}

function copyError(
  response: Response,
  body: unknown,
): never {
  const error = isObject(body) ? body.error : undefined;
  if (
    isObject(error) &&
    isNonEmpty(error.code) &&
    typeof error.message === "string" &&
    (error.requestId === undefined || isNonEmpty(error.requestId))
  ) {
    throw new SyncFeedError(error.code, error.message, {
      status: response.status,
      ...(typeof error.requestId === "string"
        ? { requestId: error.requestId }
        : {}),
    });
  }

  throw new SyncFeedError(
    "SYNC_FEED_INVALID_RESPONSE",
    "The synchronization error response was invalid.",
    { status: response.status },
  );
}

async function requestJson(
  input: RequestInfo | URL,
  init: RequestInit,
  signal: AbortSignal | undefined,
): Promise<{ response: Response; body: unknown }> {
  let response: Response;
  let text: string;

  try {
    signal?.throwIfAborted();
    response = await fetch(input, {
      ...init,
      credentials: "same-origin",
      ...(signal ? { signal } : {}),
    });
    signal?.throwIfAborted();
    text = await response.text();
    signal?.throwIfAborted();
  } catch (cause) {
    throw new SyncFeedError(
      "SYNC_FEED_TRANSPORT_FAILED",
      "The synchronization request could not be completed.",
      { cause },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (cause) {
    throw new SyncFeedError(
      "SYNC_FEED_INVALID_RESPONSE",
      "The synchronization response was not valid JSON.",
      { status: response.status, cause },
    );
  }

  if (!response.ok) {
    copyError(response, body);
  }

  return { response, body };
}

function copyChange(
  value: unknown,
  expectedHouseholdId: string,
): SyncChange | null {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      "sequence",
      "householdId",
      "moduleKey",
      "entityType",
      "entityId",
      "operation",
      "revision",
      "changedByUserId",
      "clientId",
      "changedAt",
    ]) ||
    typeof value.sequence !== "string" ||
    !POSITIVE.test(value.sequence) ||
    !isUuid(value.householdId) ||
    value.householdId.toLowerCase() !== expectedHouseholdId.toLowerCase() ||
    !isNonEmpty(value.moduleKey) ||
    !isNonEmpty(value.entityType) ||
    !isUuid(value.entityId) ||
    !isNonEmpty(value.operation) ||
    typeof value.revision !== "string" ||
    !POSITIVE.test(value.revision) ||
    (value.changedByUserId !== null && !isUuid(value.changedByUserId)) ||
    (value.clientId !== null && !isUuid(value.clientId)) ||
    !isIsoDate(value.changedAt)
  ) {
    return null;
  }

  return Object.freeze({
    sequence: value.sequence,
    householdId: value.householdId,
    moduleKey: value.moduleKey,
    entityType: value.entityType,
    entityId: value.entityId,
    operation: value.operation,
    revision: value.revision,
    changedByUserId: value.changedByUserId,
    clientId: value.clientId,
    changedAt: value.changedAt,
  });
}

export async function pullSyncChanges(
  input: {
    householdId: string;
    clientId: string;
    afterSequence: string;
    limit?: number;
  },
  signal?: AbortSignal,
): Promise<SyncChangePage> {
  validateIdentity(input.householdId, input.clientId);
  if (!NON_NEGATIVE.test(input.afterSequence)) {
    invalidInput("afterSequence must be a non-negative integer encoded as a string.");
  }
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    invalidInput("limit must be an integer between 1 and 500.");
  }

  const params = new URLSearchParams({
    after: input.afterSequence,
    limit: String(limit),
  });
  const { response, body } = await requestJson(
    `/api/v1/core/sync/changes?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "X-Homi-Household-ID": input.householdId,
        "X-Homi-Client-ID": input.clientId,
      },
    },
    signal,
  );

  const data = isObject(body) && exactKeys(body, ["data"]) ? body.data : undefined;
  if (
    !isObject(data) ||
    !exactKeys(data, ["changes", "nextSequence", "hasMore"]) ||
    !Array.isArray(data.changes) ||
    typeof data.nextSequence !== "string" ||
    !NON_NEGATIVE.test(data.nextSequence) ||
    typeof data.hasMore !== "boolean"
  ) {
    throw new SyncFeedError(
      "SYNC_FEED_INVALID_RESPONSE",
      "The change-feed response contained an invalid page.",
      { status: response.status },
    );
  }

  const changes: SyncChange[] = [];
  let previous = input.afterSequence;
  for (const raw of data.changes) {
    const change = copyChange(raw, input.householdId);
    if (!change || compareDecimal(change.sequence, previous) <= 0) {
      throw new SyncFeedError(
        "SYNC_FEED_INVALID_RESPONSE",
        "The change-feed response was not strictly ordered.",
        { status: response.status },
      );
    }
    changes.push(change);
    previous = change.sequence;
  }

  const expectedNext =
    changes.length > 0
      ? changes[changes.length - 1]!.sequence
      : input.afterSequence;
  if (data.nextSequence !== expectedNext) {
    throw new SyncFeedError(
      "SYNC_FEED_INVALID_RESPONSE",
      "The change-feed next sequence did not match the returned page.",
      { status: response.status },
    );
  }

  try {
    signal?.throwIfAborted();
  } catch (cause) {
    throw new SyncFeedError(
      "SYNC_FEED_TRANSPORT_FAILED",
      "The synchronization request was cancelled before completion.",
      { status: response.status, cause },
    );
  }

  return Object.freeze({
    changes: Object.freeze(changes),
    nextSequence: data.nextSequence,
    hasMore: data.hasMore,
  });
}

export async function acknowledgeSyncCursor(
  input: {
    householdId: string;
    clientId: string;
    lastChangeSequence: string;
  },
  signal?: AbortSignal,
): Promise<SyncCursorStatus> {
  validateIdentity(input.householdId, input.clientId);
  if (!NON_NEGATIVE.test(input.lastChangeSequence)) {
    invalidInput(
      "lastChangeSequence must be a non-negative integer encoded as a string.",
    );
  }

  const { response, body } = await requestJson(
    "/api/v1/core/sync/cursor",
    {
      method: "POST",
      headers: {
        "X-Homi-Household-ID": input.householdId,
        "X-Homi-Client-ID": input.clientId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lastChangeSequence: input.lastChangeSequence,
      }),
    },
    signal,
  );

  const data = isObject(body) && exactKeys(body, ["data"]) ? body.data : undefined;
  if (
    !isObject(data) ||
    !exactKeys(data, [
      "clientId",
      "householdId",
      "lastChangeSequence",
      "latestChangeSequence",
    ]) ||
    !isUuid(data.clientId) ||
    data.clientId.toLowerCase() !== input.clientId.toLowerCase() ||
    !isUuid(data.householdId) ||
    data.householdId.toLowerCase() !== input.householdId.toLowerCase() ||
    typeof data.lastChangeSequence !== "string" ||
    !NON_NEGATIVE.test(data.lastChangeSequence) ||
    typeof data.latestChangeSequence !== "string" ||
    !NON_NEGATIVE.test(data.latestChangeSequence) ||
    compareDecimal(data.lastChangeSequence, input.lastChangeSequence) < 0 ||
    compareDecimal(data.latestChangeSequence, data.lastChangeSequence) < 0
  ) {
    throw new SyncFeedError(
      "SYNC_FEED_INVALID_RESPONSE",
      "The cursor response contained invalid synchronization status.",
      { status: response.status },
    );
  }

  try {
    signal?.throwIfAborted();
  } catch (cause) {
    throw new SyncFeedError(
      "SYNC_FEED_TRANSPORT_FAILED",
      "The cursor request was cancelled before completion.",
      { status: response.status, cause },
    );
  }

  return Object.freeze({
    clientId: data.clientId,
    householdId: data.householdId,
    lastChangeSequence: data.lastChangeSequence,
    latestChangeSequence: data.latestChangeSequence,
  });
}
