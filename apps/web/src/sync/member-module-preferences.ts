import {
  deleteCachedRecord,
  enqueueMutation,
  getCachedRecords,
  getHouseholdMutations,
  rewriteUnsentMutation,
  seedCachedRecord,
} from "./local-db.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODULE_KEY_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const POSITIVE = /^[1-9][0-9]*$/;

export interface MemberModulePreferenceSnapshot {
  readonly id: string;
  readonly moduleId: string;
  readonly moduleKey: string;
  readonly surfaceId: string;
  readonly label: string;
  readonly visible: boolean;
  readonly displayOrder: number;
  readonly revision: string;
}

export interface MemberModulePreferencePatch {
  readonly visible?: boolean;
  readonly displayOrder?: number;
}
export class MemberModulePreferencesError extends Error {
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
    this.name = "MemberModulePreferencesError";
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
function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function parsePreference(
  value: unknown,
): MemberModulePreferenceSnapshot | null {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      "id",
      "moduleId",
      "moduleKey",
      "surfaceId",
      "label",
      "visible",
      "displayOrder",
      "revision",
    ]) ||
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    typeof value.moduleId !== "string" ||
    !UUID_PATTERN.test(value.moduleId) ||
    typeof value.moduleKey !== "string" ||
    !MODULE_KEY_PATTERN.test(value.moduleKey) ||
    typeof value.surfaceId !== "string" ||
    !MODULE_KEY_PATTERN.test(value.surfaceId) ||
    typeof value.label !== "string" ||
    value.label.trim().length === 0 ||
    typeof value.visible !== "boolean" ||
    typeof value.displayOrder !== "number" ||
    !Number.isSafeInteger(value.displayOrder) ||
    value.displayOrder < 0 ||
    typeof value.revision !== "string" ||
    !POSITIVE.test(value.revision)
  ) {
    return null;
  }

  return Object.freeze({
    id: value.id,
    moduleId: value.moduleId,
    moduleKey: value.moduleKey,
    surfaceId: value.surfaceId,
    label: value.label,
    visible: value.visible,
    displayOrder: value.displayOrder,
    revision: value.revision,
  });
}

function validateIdentity(
  householdId: string,
  clientId: string,
): void {
  if (
    !UUID_PATTERN.test(householdId) ||
    !UUID_PATTERN.test(clientId)
  ) {
    throw new MemberModulePreferencesError(
      "MEMBER_MODULE_PREFERENCES_INVALID_INPUT",
      "householdId and clientId must be valid UUIDs.",
    );
  }
}

function validatePatch(
  patch: MemberModulePreferencePatch,
): Record<string, boolean | number> {
  const output: Record<string, boolean | number> = {};
  if (patch.visible !== undefined) {
    if (typeof patch.visible !== "boolean") {
      throw new MemberModulePreferencesError(
        "MEMBER_MODULE_PREFERENCES_INVALID_INPUT",
        "visible must be a boolean.",
      );
    }
    output.visible = patch.visible;
  }
  if (patch.displayOrder !== undefined) {
    if (
      !Number.isSafeInteger(patch.displayOrder) ||
      patch.displayOrder < 0 ||
      patch.displayOrder > 2147483647
    ) {
      throw new MemberModulePreferencesError(
        "MEMBER_MODULE_PREFERENCES_INVALID_INPUT",
        "displayOrder must be a non-negative 32-bit integer.",
      );
    }
    output.displayOrder = patch.displayOrder;
  }
  if (Object.keys(output).length === 0) {
    throw new MemberModulePreferencesError(
      "MEMBER_MODULE_PREFERENCES_INVALID_INPUT",
      "At least one preference change is required.",
    );
  }
  return output;
}

function copyError(
  response: Response,
  body: unknown,
): never {
  const error = isObject(body) ? body.error : undefined;
  if (
    isObject(error) &&
    typeof error.code === "string" &&
    error.code.length > 0 &&
    typeof error.message === "string"
  ) {
    throw new MemberModulePreferencesError(
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
  throw new MemberModulePreferencesError(
    "MEMBER_MODULE_PREFERENCES_INVALID_RESPONSE",
    "The personal module preference response was invalid.",
    { status: response.status },
  );
}

export async function fetchMemberModulePreferences(
  input: {
    readonly householdId: string;
    readonly clientId: string;
  },
  signal?: AbortSignal,
): Promise<readonly MemberModulePreferenceSnapshot[]> {
  validateIdentity(input.householdId, input.clientId);

  let response: Response;
  let text: string;
  try {
    response = await fetch(
      "/api/v1/core/module-preferences",
      {
        method: "GET",
        credentials: "same-origin",
        headers: {
          "X-Homi-Household-ID": input.householdId,
          "X-Homi-Client-ID": input.clientId,
        },
        ...(signal ? { signal } : {}),
      },
    );
    text = await response.text();
  } catch (cause) {
    throw new MemberModulePreferencesError(
      "MEMBER_MODULE_PREFERENCES_TRANSPORT_FAILED",
      "Personal module preferences could not be loaded.",
      { cause },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (cause) {
    throw new MemberModulePreferencesError(
      "MEMBER_MODULE_PREFERENCES_INVALID_RESPONSE",
      "The personal module preference response was not valid JSON.",
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
    !exactKeys(data, ["preferences"]) ||
    !Array.isArray(data.preferences)
  ) {
    copyError(response, body);
  }

  const preferences = data.preferences.map((value) => {
    const preference = parsePreference(value);
    if (!preference) {
      throw new MemberModulePreferencesError(
        "MEMBER_MODULE_PREFERENCES_INVALID_RESPONSE",
        "The personal module preference catalog contained invalid data.",
        { status: response.status },
      );
    }
    return preference;
  });

  return Object.freeze(preferences);
}
export async function cacheMemberModulePreferences(
  authSubject: string,
  householdId: string,
  preferences: readonly MemberModulePreferenceSnapshot[],
): Promise<void> {
  const existing = await getCachedRecords(
    authSubject,
    householdId,
    "core",
    "member-module-preference",
  );
  const currentIds = new Set(
    preferences.map((preference) => preference.id.toLowerCase()),
  );

  await Promise.all([
    ...preferences.map((preference) =>
      seedCachedRecord(authSubject, {
        householdId,
        moduleKey: "core",
        entityType: "member-module-preference",
        entityId: preference.id,
        revision: preference.revision,
        data: preference,
      }),
    ),
    ...existing
      .filter((row) => !currentIds.has(row.entityId.toLowerCase()))
      .map((row) =>
        deleteCachedRecord(
          authSubject,
          householdId,
          {
            moduleKey: "core",
            entityType: "member-module-preference",
            entityId: row.entityId,
          },
        ),
      ),
  ]);
}

export async function getCachedMemberModulePreferences(
  authSubject: string,
  householdId: string,
): Promise<readonly MemberModulePreferenceSnapshot[]> {
  const rows = await getCachedRecords(
    authSubject,
    householdId,
    "core",
    "member-module-preference",
  );
  const preferences: MemberModulePreferenceSnapshot[] = [];
  const invalidRows = [];
  for (const row of rows) {
    const preference = parsePreference(row.data);
    if (
      !preference ||
      preference.id.toLowerCase() !== row.entityId.toLowerCase() ||
      preference.revision !== row.revision
    ) {
      invalidRows.push(row);
      continue;
    }
    preferences.push(preference);
  }
  if (invalidRows.length > 0) {
    await Promise.all(
      invalidRows.map((row) =>
        deleteCachedRecord(
          authSubject,
          householdId,
          {
            moduleKey: "core",
            entityType: "member-module-preference",
            entityId: row.entityId,
          },
        ),
      ),
    );
  }

  preferences.sort(
    (left, right) =>
      left.displayOrder - right.displayOrder ||
      left.moduleKey.localeCompare(right.moduleKey),
  );
  return Object.freeze(preferences);
}

export async function getEffectiveMemberModulePreferences(
  authSubject: string,
  householdId: string,
): Promise<readonly MemberModulePreferenceSnapshot[]> {
  const [cached, mutations] = await Promise.all([
    getCachedMemberModulePreferences(authSubject, householdId),
    getHouseholdMutations(authSubject, householdId),
  ]);
  const byId = new Map(
    cached.map((preference) => [
      preference.id,
      preference,
    ] as const),
  );

  for (const mutation of mutations) {
    if (
      mutation.moduleKey !== "core" ||
      mutation.entityType !== "member-module-preference" ||
      mutation.operation !== "update" ||
      (
        mutation.status !== "queued" &&
        mutation.status !== "sending"
      )
    ) {
      continue;
    }
    const current = byId.get(mutation.entityId);
    if (!current || !isObject(mutation.payload)) continue;

    const visible =
      typeof mutation.payload.visible === "boolean"
        ? mutation.payload.visible
        : current.visible;
    const displayOrder =
      typeof mutation.payload.displayOrder === "number" &&
      Number.isSafeInteger(mutation.payload.displayOrder) &&
      mutation.payload.displayOrder >= 0
        ? mutation.payload.displayOrder
        : current.displayOrder;

    byId.set(
      current.id,
      Object.freeze({
        ...current,
        visible,
        displayOrder,
      }),
    );
  }

  return Object.freeze(
    [...byId.values()].sort(
      (left, right) =>
        left.displayOrder - right.displayOrder ||
        left.moduleKey.localeCompare(right.moduleKey) ||
        left.surfaceId.localeCompare(right.surfaceId),
    ),
  );
}

export async function queueMemberModulePreferenceUpdate(
  authSubject: string,
  householdId: string,
  preference: MemberModulePreferenceSnapshot,
  patch: MemberModulePreferencePatch,
): Promise<void> {
  const payload = validatePatch(patch);
  const mutations = await getHouseholdMutations(
    authSubject,
    householdId,
  );
  const existing = mutations.find(
    (mutation) =>
      mutation.moduleKey === "core" &&
      mutation.entityType === "member-module-preference" &&
      mutation.entityId === preference.id &&
      mutation.operation === "update" &&
      mutation.status === "queued" &&
      mutation.attempts === 0,
  );

  if (existing) {
    await rewriteUnsentMutation(
      authSubject,
      existing.clientMutationId,
      {
        operation: "update",
        baseRevision: preference.revision,
        payload: {
          ...existing.payload,
          ...payload,
        },
      },
    );
    return;
  }

  await enqueueMutation(authSubject, {
    householdId,
    moduleKey: "core",
    entityType: "member-module-preference",
    entityId: preference.id,
    operation: "update",
    baseRevision: preference.revision,
    payload,
  });
}
