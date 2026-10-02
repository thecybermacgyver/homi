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

export interface AccountSummary {
  readonly displayName: string;
  readonly email: string | null;
  readonly passwordChangeRequired: boolean;
}

export interface HouseholdMember {
  readonly membershipId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly administrator: boolean;
  readonly self: boolean;
  readonly passwordChangeRequired: boolean;
}

async function accountRequest(
  path: string,
  init: { method?: string; body?: unknown; householdId?: string; clientId?: string },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: {
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.householdId ? { "X-Homi-Household-ID": init.householdId } : {}),
        ...(init.clientId ? { "X-Homi-Client-ID": init.clientId } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (cause) {
    throw new HomiAuthActionError(
      "AUTH_TRANSPORT_FAILED",
      "Homi could not be reached.",
      { cause },
    );
  }
  const body = await readBody(response);
  if (!response.ok) throwResponseError(response, body);
  return isObject(body) ? body.data : undefined;
}

export async function fetchAccount(): Promise<AccountSummary> {
  const data = await accountRequest("/api/v1/core/account", {});
  if (
    !isObject(data) ||
    typeof data.displayName !== "string" ||
    !(data.email === null || typeof data.email === "string") ||
    typeof data.passwordChangeRequired !== "boolean"
  ) {
    throw new HomiAuthActionError("AUTH_INVALID_RESPONSE", "The account response was invalid.");
  }
  return Object.freeze({
    displayName: data.displayName,
    email: data.email,
    passwordChangeRequired: data.passwordChangeRequired,
  });
}

export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await accountRequest("/api/v1/core/account/password", {
    method: "POST",
    body: { currentPassword, newPassword },
  });
}

export async function listHouseholdMembers(
  householdId: string,
  clientId: string,
): Promise<readonly HouseholdMember[]> {
  const data = await accountRequest("/api/v1/core/household/members", { householdId, clientId });
  if (!isObject(data) || !Array.isArray(data.members)) {
    throw new HomiAuthActionError("AUTH_INVALID_RESPONSE", "The member list was invalid.");
  }
  return Object.freeze(data.members.map((value): HouseholdMember => {
    if (
      !isObject(value) ||
      typeof value.membershipId !== "string" ||
      typeof value.displayName !== "string" ||
      !(value.email === null || typeof value.email === "string") ||
      typeof value.administrator !== "boolean" ||
      typeof value.self !== "boolean" ||
      typeof value.passwordChangeRequired !== "boolean"
    ) {
      throw new HomiAuthActionError("AUTH_INVALID_RESPONSE", "The member list was invalid.");
    }
    return Object.freeze({
      membershipId: value.membershipId,
      displayName: value.displayName,
      email: value.email,
      administrator: value.administrator,
      self: value.self,
      passwordChangeRequired: value.passwordChangeRequired,
    });
  }));
}

export async function resetMemberPassword(
  householdId: string,
  clientId: string,
  membershipId: string,
  temporaryPassword: string,
): Promise<void> {
  await accountRequest(
    `/api/v1/core/household/members/${encodeURIComponent(membershipId)}/password-reset`,
    { method: "POST", body: { temporaryPassword }, householdId, clientId },
  );
}

export async function addHouseholdMember(
  householdId: string,
  clientId: string,
  input: { displayName: string; email: string; temporaryPassword: string },
): Promise<void> {
  await accountRequest("/api/v1/core/household/members", {
    method: "POST",
    body: input,
    householdId,
    clientId,
  });
}
