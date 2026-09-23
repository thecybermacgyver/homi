const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface UnauthenticatedHouseholdDiscovery {
  status: "unauthenticated";
}

export interface AuthenticatedHouseholdDiscovery {
  status: "authenticated";
  authSubject: string;
  sessionId: string;
  coreUserId: string;
  households: Array<{
    householdId: string;
    name: string;
  }>;
}

export type HouseholdDiscoveryResult =
  | UnauthenticatedHouseholdDiscovery
  | AuthenticatedHouseholdDiscovery;

export class HouseholdDiscoveryError extends Error {
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
    this.name = "HouseholdDiscoveryError";
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

function throwIfCancelled(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

function cancellationError(
  code: "SESSION_TRANSPORT_FAILED" | "DISCOVERY_TRANSPORT_FAILED",
  cause: unknown,
  status?: number,
): HouseholdDiscoveryError {
  return new HouseholdDiscoveryError(
    code,
    "The household discovery request was cancelled before completion.",
    { cause, ...(status === undefined ? {} : { status }) },
  );
}

async function readJson(
  response: Response,
  code: "SESSION_INVALID_RESPONSE" | "HOUSEHOLD_DISCOVERY_INVALID_RESPONSE",
  message: string,
  signal?: AbortSignal,
): Promise<unknown> {
  let text: string;

  try {
    throwIfCancelled(signal);
    text = await response.text();
    throwIfCancelled(signal);
  } catch (cause) {
    if (signal?.aborted) {
      throw cancellationError(
        code === "SESSION_INVALID_RESPONSE"
          ? "SESSION_TRANSPORT_FAILED"
          : "DISCOVERY_TRANSPORT_FAILED",
        cause,
        response.status,
      );
    }

    throw new HouseholdDiscoveryError(
      code === "SESSION_INVALID_RESPONSE"
        ? "SESSION_TRANSPORT_FAILED"
        : "DISCOVERY_TRANSPORT_FAILED",
      message,
      { status: response.status, cause },
    );
  }

  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new HouseholdDiscoveryError(code, message, {
      status: response.status,
      cause,
    });
  }
}

function invalidResponse(
  message: string,
  status: number,
  cause?: unknown,
): HouseholdDiscoveryError {
  return new HouseholdDiscoveryError(
    "HOUSEHOLD_DISCOVERY_INVALID_RESPONSE",
    message,
    { status, cause },
  );
}

// Explicit invocation only; results are in-memory and carry their session identity.
export async function discoverHouseholds(
  signal?: AbortSignal,
): Promise<HouseholdDiscoveryResult> {
  let sessionResponse: Response;

  try {
    throwIfCancelled(signal);
    sessionResponse = await fetch("/api/auth/get-session", {
      method: "GET",
      credentials: "same-origin",
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    throw new HouseholdDiscoveryError(
      "SESSION_TRANSPORT_FAILED",
      "The Better Auth session request could not be completed.",
      { cause },
    );
  }

  if (!sessionResponse.ok) {
    throw new HouseholdDiscoveryError(
      "SESSION_REQUEST_FAILED",
      "The Better Auth session request failed.",
      { status: sessionResponse.status },
    );
  }

  const sessionBody = await readJson(
    sessionResponse,
    "SESSION_INVALID_RESPONSE",
    "The Better Auth session response was invalid.",
    signal,
  );

  if (sessionBody === null) {
    return { status: "unauthenticated" };
  }

  if (!isObject(sessionBody)) {
    throw new HouseholdDiscoveryError(
      "SESSION_INVALID_RESPONSE",
      "The Better Auth session response was invalid.",
      { status: sessionResponse.status },
    );
  }

  const user = sessionBody.user;
  const session = sessionBody.session;

  if (
    !isObject(user) ||
    !isObject(session) ||
    !isUuid(user.id) ||
    !isUuid(session.id) ||
    !isUuid(session.userId) ||
    session.userId !== user.id
  ) {
    throw new HouseholdDiscoveryError(
      "SESSION_INVALID_RESPONSE",
      "The Better Auth session response was invalid.",
      { status: sessionResponse.status },
    );
  }

  let discoveryResponse: Response;

  try {
    throwIfCancelled(signal);
    discoveryResponse = await fetch("/api/v1/core/households", {
      method: "GET",
      credentials: "same-origin",
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    throw new HouseholdDiscoveryError(
      "DISCOVERY_TRANSPORT_FAILED",
      "The household discovery request could not be completed.",
      { cause },
    );
  }

  const discoveryBody = await readJson(
    discoveryResponse,
    "HOUSEHOLD_DISCOVERY_INVALID_RESPONSE",
    "The household discovery response was invalid.",
    signal,
  );

  if (!discoveryResponse.ok) {
    const error = isObject(discoveryBody) ? discoveryBody.error : undefined;

    if (
      isObject(error) &&
      isNonEmptyString(error.code) &&
      typeof error.message === "string" &&
      (error.requestId === undefined || isNonEmptyString(error.requestId))
    ) {
      throw new HouseholdDiscoveryError(error.code, error.message, {
        status: discoveryResponse.status,
        ...(typeof error.requestId === "string"
          ? { requestId: error.requestId }
          : {}),
      });
    }

    throw invalidResponse(
      "The household discovery error response was invalid.",
      discoveryResponse.status,
    );
  }

  const data = isObject(discoveryBody) ? discoveryBody.data : undefined;
  const households = isObject(data) ? data.households : undefined;

  if (
    !isObject(data) ||
    !isUuid(data.userId) ||
    !Array.isArray(households) ||
    households.some(
      (household) =>
        !isObject(household) ||
        !isUuid(household.householdId) ||
        !isNonEmptyString(household.name),
    )
  ) {
    throw invalidResponse(
      "The household discovery response was invalid.",
      discoveryResponse.status,
    );
  }

  try {
    throwIfCancelled(signal);
  } catch (cause) {
    throw cancellationError(
      "DISCOVERY_TRANSPORT_FAILED",
      cause,
      discoveryResponse.status,
    );
  }

  return {
    status: "authenticated",
    authSubject: user.id,
    sessionId: session.id,
    coreUserId: data.userId,
    households: households.map((household) => ({
      householdId: household.householdId as string,
      name: household.name as string,
    })),
  };
}
