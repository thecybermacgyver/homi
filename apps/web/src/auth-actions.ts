export class HomiAuthActionError extends Error {
  readonly status: number | undefined;

  constructor(
    public readonly code: string,
    message: string,
    options: ErrorOptions & { status?: number } = {},
  ) {
    super(message, options);
    this.name = "HomiAuthActionError";
    this.status = options.status;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new HomiAuthActionError(
      "AUTH_INVALID_RESPONSE",
      "The authentication response was not valid JSON.",
      { status: response.status, cause },
    );
  }
}

function throwResponseError(response: Response, body: unknown): never {
  const source = isObject(body) ? body : {};
  const nested = isObject(source.error) ? source.error : source;
  const code =
    typeof nested.code === "string" && nested.code.trim()
      ? nested.code
      : "AUTH_REQUEST_FAILED";
  const message =
    typeof nested.message === "string" && nested.message.trim()
      ? nested.message
      : "Authentication failed.";

  throw new HomiAuthActionError(code, message, {
    status: response.status,
  });
}

export async function signInWithEmail(
  email: string,
  password: string,
  signal?: AbortSignal,
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    throw new HomiAuthActionError(
      "AUTH_INVALID_INPUT",
      "Email and password are required.",
    );
  }

  let response: Response;
  try {
    signal?.throwIfAborted();
    response = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: normalizedEmail,
        password,
      }),
      ...(signal ? { signal } : {}),
    });
    signal?.throwIfAborted();
  } catch (cause) {
    throw new HomiAuthActionError(
      "AUTH_TRANSPORT_FAILED",
      "The sign-in request could not be completed.",
      { cause },
    );
  }

  const body = await readBody(response);
  if (!response.ok) {
    throwResponseError(response, body);
  }

  signal?.throwIfAborted();
}

export async function signOut(
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;

  try {
    signal?.throwIfAborted();
    response = await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "same-origin",
      ...(signal ? { signal } : {}),
    });
    signal?.throwIfAborted();
  } catch (cause) {
    throw new HomiAuthActionError(
      "AUTH_TRANSPORT_FAILED",
      "The sign-out request could not be completed.",
      { cause },
    );
  }

  const body = await readBody(response);
  if (!response.ok) {
    throwResponseError(response, body);
  }

  signal?.throwIfAborted();
}
