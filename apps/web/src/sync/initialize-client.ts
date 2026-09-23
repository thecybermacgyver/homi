import {
  getOrCreateClientInstanceId,
  setClientIdForAuthSubject,
} from "./local-db.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ClientIdentity {
  authSubject: string;
  clientId: string;
  clientInstanceId: string;
}

export class ClientInitializationError extends Error {
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
    this.name = "ClientInitializationError";
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

function throwIfCancelled(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

function cancellationError(
  cause: unknown,
  status?: number,
): ClientInitializationError {
  return new ClientInitializationError(
    "CLIENT_INIT_TRANSPORT_FAILED",
    "The client registration request was cancelled before completion.",
    { cause, ...(status === undefined ? {} : { status }) },
  );
}

// One explicit invocation; lifecycle and concurrent initialization are separate work.
export async function initializeClient(
  authSubject: string,
  signal?: AbortSignal,
): Promise<ClientIdentity> {
  if (!isUuid(authSubject)) {
    throw new ClientInitializationError(
      "CLIENT_INIT_INVALID_INPUT",
      "authSubject must be a valid UUID.",
    );
  }

  try {
    throwIfCancelled(signal);
  } catch (cause) {
    throw cancellationError(cause);
  }

  let clientInstanceId: string;

  try {
    clientInstanceId = await getOrCreateClientInstanceId();
  } catch (cause) {
    throw new ClientInitializationError(
      "CLIENT_INIT_STORAGE_FAILED",
      "The local client instance identity could not be loaded or stored.",
      { cause },
    );
  }

  try {
    throwIfCancelled(signal);
  } catch (cause) {
    throw cancellationError(cause);
  }

  let response: Response;

  try {
    throwIfCancelled(signal);
    response = await fetch("/api/v1/core/sync/clients/register", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientInstanceId }),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    if (signal?.aborted) {
      throw cancellationError(cause);
    }

    throw new ClientInitializationError(
      "CLIENT_INIT_TRANSPORT_FAILED",
      "The client registration request could not be completed.",
      { cause },
    );
  }

  let responseText: string;

  try {
    throwIfCancelled(signal);
    responseText = await response.text();
  } catch (cause) {
    if (signal?.aborted) {
      throw cancellationError(cause, response.status);
    }

    throw new ClientInitializationError(
      "CLIENT_INIT_TRANSPORT_FAILED",
      "The client registration response could not be received.",
      { status: response.status, cause },
    );
  }

  try {
    throwIfCancelled(signal);
  } catch (cause) {
    throw cancellationError(cause, response.status);
  }

  let body: unknown;

  try {
    body = JSON.parse(responseText);
  } catch (cause) {
    throw new ClientInitializationError(
      "CLIENT_INIT_INVALID_RESPONSE",
      "The client registration response was not valid JSON.",
      { status: response.status, cause },
    );
  }

  if (!response.ok) {
    const error = isObject(body) ? body.error : undefined;

    if (
      isObject(error) &&
      typeof error.code === "string" &&
      error.code.trim().length > 0 &&
      typeof error.message === "string" &&
      (error.requestId === undefined ||
        (typeof error.requestId === "string" && error.requestId.trim().length > 0))
    ) {
      throw new ClientInitializationError(error.code, error.message, {
        status: response.status,
        ...(typeof error.requestId === "string"
          ? { requestId: error.requestId }
          : {}),
      });
    }

    throw new ClientInitializationError(
      "CLIENT_INIT_INVALID_RESPONSE",
      "The client registration error response was invalid.",
      { status: response.status },
    );
  }

  const data = isObject(body) ? body.data : undefined;

  if (
    !isObject(data) ||
    !isUuid(data.authSubject) ||
    !isUuid(data.id) ||
    !isUuid(data.clientInstanceId) ||
    data.clientInstanceId !== clientInstanceId
  ) {
    throw new ClientInitializationError(
      "CLIENT_INIT_INVALID_RESPONSE",
      "The client registration response contained an invalid identity.",
      { status: response.status },
    );
  }

  if (data.authSubject !== authSubject) {
    throw new ClientInitializationError(
      "CLIENT_INIT_OWNERSHIP_MISMATCH",
      "The registration response belongs to a different authenticated account.",
      { status: response.status },
    );
  }

  try {
    throwIfCancelled(signal);
  } catch (cause) {
    throw cancellationError(cause, response.status);
  }

  try {
    await setClientIdForAuthSubject(authSubject, data.id);
  } catch (cause) {
    throw new ClientInitializationError(
      "CLIENT_INIT_STORAGE_FAILED",
      "The registered client identity could not be stored locally.",
      { cause },
    );
  }

  try {
    throwIfCancelled(signal);
  } catch (cause) {
    throw cancellationError(cause, response.status);
  }

  return {
    authSubject: data.authSubject,
    clientId: data.id,
    clientInstanceId,
  };
}
