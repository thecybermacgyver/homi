const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ResolvedSyncContext {
  requestId: string;
  userId: string;
  householdId: string;
  membershipId: string;
  householdPersonId: string;
  clientId: string;
  locale: string;
  timeZone: string;
}

export class ContextResolutionError extends Error {
  readonly status: number | undefined;
  readonly requestId: string | undefined;

  constructor(
    public readonly code: string,
    message: string,
    options: ErrorOptions & { status?: number; requestId?: string } = {},
  ) {
    super(message, options);
    this.name = "ContextResolutionError";
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Explicit invocation only; the returned context is not a lasting authorization grant.
export async function resolveSyncContext(
  householdId: string,
  clientId: string,
  signal?: AbortSignal,
): Promise<ResolvedSyncContext> {
  if (!isUuid(householdId) || !isUuid(clientId)) {
    throw new ContextResolutionError(
      "CONTEXT_INVALID_INPUT",
      "householdId and clientId must be valid UUIDs.",
    );
  }

  let response: Response;

  try {
    signal?.throwIfAborted();
    response = await fetch("/api/v1/core/context", {
      method: "GET",
      credentials: "same-origin",
      headers: {
        "X-Homi-Household-ID": householdId,
        "X-Homi-Client-ID": clientId,
      },
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    throw new ContextResolutionError(
      "CONTEXT_TRANSPORT_FAILED",
      "The context request could not be completed.",
      { cause },
    );
  }

  let responseText: string;

  try {
    signal?.throwIfAborted();
    responseText = await response.text();
    signal?.throwIfAborted();
  } catch (cause) {
    throw new ContextResolutionError(
      "CONTEXT_TRANSPORT_FAILED",
      "The context response could not be received.",
      { status: response.status, cause },
    );
  }

  let body: unknown;

  try {
    body = JSON.parse(responseText);
  } catch (cause) {
    throw new ContextResolutionError(
      "CONTEXT_INVALID_RESPONSE",
      "The context response was not valid JSON.",
      { status: response.status, cause },
    );
  }

  if (!response.ok) {
    const error = isObject(body) ? body.error : undefined;

    if (
      isObject(error) &&
      isNonEmptyString(error.code) &&
      typeof error.message === "string" &&
      (error.requestId === undefined || isNonEmptyString(error.requestId))
    ) {
      throw new ContextResolutionError(error.code, error.message, {
        status: response.status,
        ...(typeof error.requestId === "string"
          ? { requestId: error.requestId }
          : {}),
      });
    }

    throw new ContextResolutionError(
      "CONTEXT_INVALID_RESPONSE",
      "The context error response was invalid.",
      { status: response.status },
    );
  }

  const data = isObject(body) ? body.data : undefined;

  if (
    !isObject(data) ||
    !isNonEmptyString(data.requestId) ||
    !isUuid(data.userId) ||
    !isUuid(data.householdId) ||
    !isUuid(data.membershipId) ||
    !isUuid(data.householdPersonId) ||
    !isUuid(data.clientId) ||
    !isNonEmptyString(data.locale) ||
    !isNonEmptyString(data.timeZone) ||
    data.householdId !== householdId ||
    data.clientId !== clientId
  ) {
    throw new ContextResolutionError(
      "CONTEXT_INVALID_RESPONSE",
      "The context response contained an invalid context.",
      { status: response.status },
    );
  }

  try {
    signal?.throwIfAborted();
  } catch (cause) {
    throw new ContextResolutionError(
      "CONTEXT_TRANSPORT_FAILED",
      "The context request was cancelled before completion.",
      { status: response.status, cause },
    );
  }

  return {
    requestId: data.requestId,
    userId: data.userId,
    householdId: data.householdId,
    membershipId: data.membershipId,
    householdPersonId: data.householdPersonId,
    clientId: data.clientId,
    locale: data.locale,
    timeZone: data.timeZone,
  };
}
