import type {
  MutationDeliveryAdapter,
  MutationSubmissionResult,
} from "./deliver-mutations.js";
import type { QueuedMutation } from "./local-db.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NON_NEGATIVE = /^(0|[1-9][0-9]*)$/;
const POSITIVE = /^[1-9][0-9]*$/;

export class MemberModulePreferenceSubmissionError extends Error {
  readonly status: number | undefined;
  readonly requestId: string | undefined;

  constructor(
    public readonly code: string,
    message: string,
    options: ErrorOptions & {
      status?: number;
      requestId?: string;
    } = {},
  ) {
    super(message, options);
    this.name = "MemberModulePreferenceSubmissionError";
    this.status = options.status;
    this.requestId = options.requestId;
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

function nonEmpty(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0
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
function invalidInput(message: string): never {
  throw new MemberModulePreferenceSubmissionError(
    "MUTATION_SUBMISSION_INVALID_INPUT",
    message,
  );
}

function validateMutation(
  mutation: QueuedMutation,
  clientId: string,
): void {
  if (!UUID_PATTERN.test(clientId)) {
    invalidInput("clientId must be a valid UUID.");
  }
  if (
    mutation.moduleKey !== "core" ||
    mutation.entityType !== "member-module-preference" ||
    mutation.operation !== "update" ||
    !UUID_PATTERN.test(mutation.householdId) ||
    !UUID_PATTERN.test(mutation.clientMutationId) ||
    !UUID_PATTERN.test(mutation.entityId) ||
    !POSITIVE.test(mutation.baseRevision) ||
    !isObject(mutation.payload)
  ) {
    invalidInput("The queued personal module preference mutation is invalid.");
  }
}
function copyError(
  response: Response,
  body: unknown,
): never {
  const error = isObject(body) ? body.error : undefined;
  if (
    isObject(error) &&
    nonEmpty(error.code) &&
    typeof error.message === "string"
  ) {
    throw new MemberModulePreferenceSubmissionError(
      error.code,
      error.message,
      {
        status: response.status,
        ...(typeof error.requestId === "string"
          ? { requestId: error.requestId }
          : {}),
      },
    );
  }
  throw new MemberModulePreferenceSubmissionError(
    "MUTATION_SUBMISSION_INVALID_RESPONSE",
    "The personal module preference mutation response was invalid.",
    { status: response.status },
  );
}
async function submit(
  mutation: QueuedMutation,
  clientId: string,
  signal?: AbortSignal,
): Promise<MutationSubmissionResult> {
  validateMutation(mutation, clientId);

  let response: Response;
  let text: string;
  try {
    signal?.throwIfAborted();
    response = await fetch(
      "/api/v1/core/sync/mutations",
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "X-Homi-Household-ID": mutation.householdId,
          "X-Homi-Client-ID": clientId,
          "Content-Type": "application/json",
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
    signal?.throwIfAborted();
    text = await response.text();
    signal?.throwIfAborted();
  } catch (cause) {
    throw new MemberModulePreferenceSubmissionError(
      "MUTATION_SUBMISSION_TRANSPORT_FAILED",
      "The personal module preference mutation did not complete.",
      { cause },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (cause) {
    throw new MemberModulePreferenceSubmissionError(
      "MUTATION_SUBMISSION_INVALID_RESPONSE",
      "The mutation response was not valid JSON.",
      { status: response.status, cause },
    );
  }
  if (!response.ok) copyError(response, body);
  const data =
    isObject(body) && exactKeys(body, ["data"])
      ? body.data
      : undefined;
  if (
    !isObject(data) ||
    !exactKeys(data, [
      "clientMutationId",
      "status",
      "serverRevision",
      "changeSequence",
      "errorCode",
      "serverState",
      "replayed",
    ]) ||
    data.clientMutationId !== mutation.clientMutationId ||
    (
      data.status !== "received" &&
      data.status !== "applied" &&
      data.status !== "conflict" &&
      data.status !== "rejected"
    ) ||
    (
      data.serverRevision !== null &&
      (
        typeof data.serverRevision !== "string" ||
        !POSITIVE.test(data.serverRevision)
      )
    ) ||
    (
      data.changeSequence !== null &&
      (
        typeof data.changeSequence !== "string" ||
        !NON_NEGATIVE.test(data.changeSequence)
      )
    ) ||
    (
      data.errorCode !== null &&
      !nonEmpty(data.errorCode)
    ) ||
    typeof data.replayed !== "boolean"
  ) {
    throw new MemberModulePreferenceSubmissionError(
      "MUTATION_SUBMISSION_INVALID_RESPONSE",
      "The mutation response contained an invalid result.",
      { status: response.status },
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
export const memberModulePreferenceMutationAdapter:
  MutationDeliveryAdapter = Object.freeze({
    moduleKey: "core",
    entityType: "member-module-preference",
    operations: Object.freeze(["update"]),
    submit,
  });
