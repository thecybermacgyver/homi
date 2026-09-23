const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE = /^[1-9][0-9]*$/;

export interface HouseholdSettingsSnapshot {
  readonly id: string;
  readonly name: string;
  readonly defaultLocale: string;
  readonly timeZone: string;
  readonly revision: string;
}

export class HouseholdSettingsFetchError extends Error {
  readonly status: number | undefined;
  readonly requestId: string | undefined;

  constructor(
    public readonly code: string,
    message: string,
    options: ErrorOptions & { status?: number; requestId?: string } = {},
  ) {
    super(message, options);
    this.name = "HouseholdSettingsFetchError";
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

function invalidInput(message: string): never {
  throw new HouseholdSettingsFetchError(
    "HOUSEHOLD_SETTINGS_INVALID_INPUT",
    message,
  );
}

export async function fetchHouseholdSettings(
  input: {
    householdId: string;
    clientId: string;
  },
  signal?: AbortSignal,
): Promise<HouseholdSettingsSnapshot> {
  if (!isUuid(input.householdId) || !isUuid(input.clientId)) {
    invalidInput("householdId and clientId must be valid UUIDs.");
  }

  let response: Response;
  let text: string;

  try {
    signal?.throwIfAborted();
    response = await fetch("/api/v1/core/household/settings", {
      method: "GET",
      credentials: "same-origin",
      headers: {
        "X-Homi-Household-ID": input.householdId,
        "X-Homi-Client-ID": input.clientId,
      },
      ...(signal ? { signal } : {}),
    });
    signal?.throwIfAborted();
    text = await response.text();
    signal?.throwIfAborted();
  } catch (cause) {
    throw new HouseholdSettingsFetchError(
      "HOUSEHOLD_SETTINGS_TRANSPORT_FAILED",
      "The household settings request could not be completed.",
      { cause },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (cause) {
    throw new HouseholdSettingsFetchError(
      "HOUSEHOLD_SETTINGS_INVALID_RESPONSE",
      "The household settings response was not valid JSON.",
      { status: response.status, cause },
    );
  }

  if (!response.ok) {
    const error = isObject(body) ? body.error : undefined;
    if (
      isObject(error) &&
      isNonEmpty(error.code) &&
      typeof error.message === "string" &&
      (error.requestId === undefined || isNonEmpty(error.requestId))
    ) {
      throw new HouseholdSettingsFetchError(error.code, error.message, {
        status: response.status,
        ...(typeof error.requestId === "string"
          ? { requestId: error.requestId }
          : {}),
      });
    }

    throw new HouseholdSettingsFetchError(
      "HOUSEHOLD_SETTINGS_INVALID_RESPONSE",
      "The household settings error response was invalid.",
      { status: response.status },
    );
  }

  const data = isObject(body) && exactKeys(body, ["data"]) ? body.data : undefined;
  if (
    !isObject(data) ||
    !exactKeys(data, ["id", "name", "defaultLocale", "timeZone", "revision"]) ||
    !isUuid(data.id) ||
    data.id.toLowerCase() !== input.householdId.toLowerCase() ||
    typeof data.name !== "string" ||
    !isNonEmpty(data.defaultLocale) ||
    !isNonEmpty(data.timeZone) ||
    typeof data.revision !== "string" ||
    !POSITIVE.test(data.revision)
  ) {
    throw new HouseholdSettingsFetchError(
      "HOUSEHOLD_SETTINGS_INVALID_RESPONSE",
      "The household settings response contained an invalid snapshot.",
      { status: response.status },
    );
  }

  try {
    signal?.throwIfAborted();
  } catch (cause) {
    throw new HouseholdSettingsFetchError(
      "HOUSEHOLD_SETTINGS_TRANSPORT_FAILED",
      "The household settings request was cancelled before completion.",
      { status: response.status, cause },
    );
  }

  return Object.freeze({
    id: data.id,
    name: data.name,
    defaultLocale: data.defaultLocale,
    timeZone: data.timeZone,
    revision: data.revision,
  });
}
