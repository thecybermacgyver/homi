const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SubmitMutationInput {
  readonly householdId: string;
  readonly clientId: string;
  readonly clientMutationId: string;
  readonly moduleKey: "core";
  readonly entityType: "household";
  readonly entityId: string;
  readonly operation: "update";
  readonly baseRevision: string;
  readonly payload: Readonly<{ name?: string; defaultLocale?: string; timeZone?: string }>;
}

export interface MutationServerState {
  readonly id: string;
  readonly name: string;
  readonly defaultLocale: string;
  readonly timeZone: string;
  readonly revision: string;
}

export interface SubmittedMutationResult {
  readonly clientMutationId: string;
  readonly status: "received" | "applied" | "conflict" | "rejected";
  readonly serverRevision: string | null;
  readonly changeSequence: string | null;
  readonly errorCode: string | null;
  readonly serverState: MutationServerState | null;
  readonly replayed: boolean;
}

export class MutationSubmissionError extends Error {
  readonly status: number | undefined;
  readonly requestId: string | undefined;

  constructor(
    public readonly code: string,
    message: string,
    options: ErrorOptions & { status?: number; requestId?: string } = {},
  ) {
    super(message, options);
    this.name = "MutationSubmissionError";
    this.status = options.status;
    this.requestId = options.requestId;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
function isPositive(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value);
}
function isSequence(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
}
function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function invalidInput(message: string): never {
  throw new MutationSubmissionError("MUTATION_SUBMISSION_INVALID_INPUT", message);
}

// Mirrors sync-routes.ts parsing, including undefined optional settings and
// canonicalization. Never serialize the caller's object or invoke its toJSON.
function captureInput(value: SubmitMutationInput) {
  if (!isObject(value)) invalidInput("A mutation object is required.");
  const allowed = ["householdId", "clientId", "clientMutationId", "moduleKey",
    "entityType", "entityId", "operation", "baseRevision", "payload"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalidInput("Unknown mutation field.");
  const { householdId, clientId, clientMutationId, moduleKey, entityType,
    entityId, operation, baseRevision, payload: source } = value;
  if (!isUuid(householdId) || !isUuid(clientId) || !isUuid(clientMutationId) || !isUuid(entityId)) {
    invalidInput("householdId, clientId, clientMutationId and entityId must be valid UUIDs.");
  }
  if (entityId !== householdId) invalidInput("entityId must equal householdId.");
  if (moduleKey !== "core" || entityType !== "household" || operation !== "update") {
    invalidInput("Only core household update mutations are supported.");
  }
  if (!isPositive(baseRevision)) invalidInput("baseRevision must be a positive integer encoded as a string.");
  if (!isObject(source)) invalidInput("payload must be a JSON object.");
  if (Object.keys(source).some((key) => !["name", "defaultLocale", "timeZone"].includes(key))) {
    invalidInput("Unknown payload field.");
  }
  const payload: { name?: string; defaultLocale?: string; timeZone?: string } = {};
  const { name, defaultLocale, timeZone } = source;
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 120) {
      invalidInput("payload.name must contain between 1 and 120 characters.");
    }
    payload.name = name.trim();
  }
  if (defaultLocale !== undefined) {
    if (typeof defaultLocale !== "string") invalidInput("payload.defaultLocale must be a string.");
    const locale = Intl.getCanonicalLocales(defaultLocale)[0];
    if (!locale) invalidInput("payload.defaultLocale must be a valid locale.");
    payload.defaultLocale = locale;
  }
  if (timeZone !== undefined) {
    if (typeof timeZone !== "string") invalidInput("payload.timeZone must be a string.");
    new Intl.DateTimeFormat("en", { timeZone }).format();
    payload.timeZone = timeZone;
  }
  if (Object.keys(payload).length === 0) invalidInput("payload must contain at least one household setting.");
  return { householdId, clientId, clientMutationId, body: JSON.stringify({
    clientMutationId, moduleKey, entityType, entityId, operation, baseRevision, payload,
  }) };
}

function copyServerState(value: unknown): MutationServerState | null | undefined {
  if (value === null) return null;
  if (!isObject(value) || !exactKeys(value, ["id", "name", "defaultLocale", "timeZone", "revision"]) ||
      !isUuid(value.id) || typeof value.name !== "string" ||
      typeof value.defaultLocale !== "string" || typeof value.timeZone !== "string" ||
      !isPositive(value.revision)) return undefined;
  // Authoritative stored strings are not reparsed as new settings or normalized.
  return Object.freeze({ id: value.id, name: value.name, defaultLocale: value.defaultLocale,
    timeZone: value.timeZone, revision: value.revision });
}

// One explicit request only. Received is nonterminal. After dispatch, transport
// failure/cancellation leaves the server outcome unknown; callers must retain ID.
export async function submitMutation(
  input: SubmitMutationInput,
  signal?: AbortSignal,
): Promise<SubmittedMutationResult> {
  let captured: ReturnType<typeof captureInput>;
  try {
    captured = captureInput(input);
  } catch (cause) {
    if (cause instanceof MutationSubmissionError) throw cause;
    throw new MutationSubmissionError("MUTATION_SUBMISSION_INVALID_INPUT", "Invalid mutation input.", { cause });
  }
  let status: number | undefined;
  let dispatched = false;
  function checkCancellation(): void {
    signal?.throwIfAborted();
  }
  function transport(cause: unknown): MutationSubmissionError {
    return new MutationSubmissionError("MUTATION_SUBMISSION_TRANSPORT_FAILED",
      dispatched ? "Mutation submission did not complete; the server outcome is unknown."
        : "Mutation submission was cancelled before dispatch.",
      { cause, ...(status === undefined ? {} : { status }) });
  }
  let response: Response;
  let responseText: string;
  try {
    checkCancellation();
    dispatched = true;
    response = await fetch("/api/v1/core/sync/mutations", {
      method: "POST", credentials: "same-origin",
      headers: { "X-Homi-Household-ID": captured.householdId,
        "X-Homi-Client-ID": captured.clientId, "Content-Type": "application/json" },
      body: captured.body,
      ...(signal ? { signal } : {}),
    });
    status = response.status;
    checkCancellation();
    responseText = await response.text();
    checkCancellation();
  } catch (cause) {
    throw transport(cause);
  }
  function invalidResponse(message: string, cause?: unknown): never {
    throw new MutationSubmissionError("MUTATION_SUBMISSION_INVALID_RESPONSE", message, { status: response.status, cause });
  }
  let body: unknown;
  try {
    body = JSON.parse(responseText);
  } catch (cause) {
    invalidResponse("The mutation response was not valid JSON.", cause);
  }
  if (!response.ok) {
    const error = isObject(body) ? body.error : undefined;
    if (isObject(error) && isNonEmpty(error.code) && typeof error.message === "string" &&
        (error.requestId === undefined || isNonEmpty(error.requestId))) {
      throw new MutationSubmissionError(error.code, error.message, {
        status, ...(typeof error.requestId === "string" ? { requestId: error.requestId } : {}),
      });
    }
    invalidResponse("The mutation error response was invalid.");
  }
  const data = isObject(body) && exactKeys(body, ["data"]) ? body.data : undefined;
  if (!isObject(data) || !exactKeys(data, ["clientMutationId", "status", "serverRevision",
    "changeSequence", "errorCode", "serverState", "replayed"]) ||
      data.clientMutationId !== captured.clientMutationId ||
      (data.status !== "received" && data.status !== "applied" && data.status !== "conflict" && data.status !== "rejected") ||
      (data.serverRevision !== null && !isPositive(data.serverRevision)) ||
      (data.changeSequence !== null && !isSequence(data.changeSequence)) ||
      (data.errorCode !== null && !isNonEmpty(data.errorCode)) || typeof data.replayed !== "boolean") {
    invalidResponse("The mutation response contained an invalid result.");
  }
  const serverState = copyServerState(data.serverState);
  if (serverState === undefined) invalidResponse("The mutation response contained invalid serverState.");
  const result: SubmittedMutationResult = Object.freeze({
    clientMutationId: captured.clientMutationId, status: data.status,
    serverRevision: data.serverRevision, changeSequence: data.changeSequence,
    errorCode: data.errorCode, serverState, replayed: data.replayed,
  });
  try {
    checkCancellation();
  } catch (cause) {
    throw transport(cause);
  }
  return result;
}
