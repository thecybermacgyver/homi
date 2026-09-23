import {
  getCachedRecords,
  seedCachedRecord,
} from "./local-db.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODULE_KEY_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const NON_NEGATIVE = /^(0|[1-9][0-9]*)$/;

export type HouseholdModuleSetupState =
  | "not-required"
  | "configured"
  | "unconfigured"
  | "unavailable";

export interface HouseholdModuleSnapshot {
  readonly id: string;
  readonly moduleKey: string;
  readonly name: string;
  readonly publisher: string;
  readonly version: string;
  readonly globalState: string;
  readonly available: boolean;
  readonly enabled: boolean;
  readonly revision: string;
  readonly setupRequired: boolean | null;
  readonly setupState: HouseholdModuleSetupState;
}

export interface HouseholdModuleCatalog {
  readonly modules: readonly HouseholdModuleSnapshot[];
  readonly canManage: boolean;
}

export class HouseholdModulesError extends Error {
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
    this.name = "HouseholdModulesError";
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

function nonEmpty(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

function validSetupState(
  value: unknown,
): value is HouseholdModuleSetupState {
  return (
    value === "not-required" ||
    value === "configured" ||
    value === "unconfigured" ||
    value === "unavailable"
  );
}

function parseModule(
  value: unknown,
): HouseholdModuleSnapshot | null {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      "id",
      "moduleKey",
      "name",
      "publisher",
      "version",
      "globalState",
      "available",
      "enabled",
      "revision",
      "setupRequired",
      "setupState",
    ]) ||
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    typeof value.moduleKey !== "string" ||
    !MODULE_KEY_PATTERN.test(value.moduleKey) ||
    !nonEmpty(value.name) ||
    !nonEmpty(value.publisher) ||
    !nonEmpty(value.version) ||
    !nonEmpty(value.globalState) ||
    typeof value.available !== "boolean" ||
    typeof value.enabled !== "boolean" ||
    typeof value.revision !== "string" ||
    !NON_NEGATIVE.test(value.revision) ||
    (typeof value.setupRequired !== "boolean" &&
      value.setupRequired !== null) ||
    !validSetupState(value.setupState)
  ) {
    return null;
  }

  return Object.freeze({
    id: value.id,
    moduleKey: value.moduleKey,
    name: value.name,
    publisher: value.publisher,
    version: value.version,
    globalState: value.globalState,
    available: value.available,
    enabled: value.enabled,
    revision: value.revision,
    setupRequired: value.setupRequired,
    setupState: value.setupState,
  });
}

function copyError(
  response: Response,
  body: unknown,
): never {
  const error = isObject(body) ? body.error : undefined;

  if (
    isObject(error) &&
    nonEmpty(error.code) &&
    typeof error.message === "string" &&
    (error.requestId === undefined ||
      nonEmpty(error.requestId))
  ) {
    throw new HouseholdModulesError(
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

  throw new HouseholdModulesError(
    "HOUSEHOLD_MODULES_INVALID_RESPONSE",
    "The module-management error response was invalid.",
    { status: response.status },
  );
}

async function requestJson(
  input: RequestInfo | URL,
  init: RequestInit,
  signal: AbortSignal | undefined,
): Promise<{
  readonly response: Response;
  readonly body: unknown;
}> {
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
    throw new HouseholdModulesError(
      "HOUSEHOLD_MODULES_TRANSPORT_FAILED",
      "The module-management request could not be completed.",
      { cause },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (cause) {
    throw new HouseholdModulesError(
      "HOUSEHOLD_MODULES_INVALID_RESPONSE",
      "The module-management response was not valid JSON.",
      { status: response.status, cause },
    );
  }

  if (!response.ok) copyError(response, body);

  return { response, body };
}

function validateIdentity(
  householdId: string,
  clientId: string,
): void {
  if (
    !UUID_PATTERN.test(householdId) ||
    !UUID_PATTERN.test(clientId)
  ) {
    throw new HouseholdModulesError(
      "HOUSEHOLD_MODULES_INVALID_INPUT",
      "householdId and clientId must be valid UUIDs.",
    );
  }
}

export async function fetchHouseholdModules(
  input: {
    readonly householdId: string;
    readonly clientId: string;
  },
  signal?: AbortSignal,
): Promise<HouseholdModuleCatalog> {
  validateIdentity(input.householdId, input.clientId);

  const { response, body } = await requestJson(
    "/api/v1/core/modules",
    {
      method: "GET",
      headers: {
        "X-Homi-Household-ID": input.householdId,
        "X-Homi-Client-ID": input.clientId,
      },
    },
    signal,
  );

  const data =
    isObject(body) && exactKeys(body, ["data"])
      ? body.data
      : undefined;

  if (
    !isObject(data) ||
    !exactKeys(data, ["modules", "canManage"]) ||
    !Array.isArray(data.modules) ||
    typeof data.canManage !== "boolean"
  ) {
    throw new HouseholdModulesError(
      "HOUSEHOLD_MODULES_INVALID_RESPONSE",
      "The module catalog response was invalid.",
      { status: response.status },
    );
  }

  const modules: HouseholdModuleSnapshot[] = [];
  for (const value of data.modules) {
    const module = parseModule(value);
    if (!module) {
      throw new HouseholdModulesError(
        "HOUSEHOLD_MODULES_INVALID_RESPONSE",
        "The module catalog contained an invalid module.",
        { status: response.status },
      );
    }
    modules.push(module);
  }

  return Object.freeze({
    modules: Object.freeze(modules),
    canManage: data.canManage,
  });
}

export async function updateHouseholdModule(
  input: {
    readonly householdId: string;
    readonly clientId: string;
    readonly moduleKey: string;
    readonly enabled: boolean;
    readonly baseRevision: string;
  },
  signal?: AbortSignal,
): Promise<HouseholdModuleSnapshot> {
  validateIdentity(input.householdId, input.clientId);

  if (!MODULE_KEY_PATTERN.test(input.moduleKey)) {
    throw new HouseholdModulesError(
      "HOUSEHOLD_MODULES_INVALID_INPUT",
      "moduleKey is invalid.",
    );
  }

  if (!NON_NEGATIVE.test(input.baseRevision)) {
    throw new HouseholdModulesError(
      "HOUSEHOLD_MODULES_INVALID_INPUT",
      "baseRevision must be a non-negative integer string.",
    );
  }

  const { response, body } = await requestJson(
    "/api/v1/core/modules/" +
      encodeURIComponent(input.moduleKey),
    {
      method: "PATCH",
      headers: {
        "X-Homi-Household-ID": input.householdId,
        "X-Homi-Client-ID": input.clientId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled: input.enabled,
        baseRevision: input.baseRevision,
      }),
    },
    signal,
  );

  const data =
    isObject(body) && exactKeys(body, ["data"])
      ? body.data
      : undefined;
  const module = parseModule(data);

  if (!module || module.moduleKey !== input.moduleKey) {
    throw new HouseholdModulesError(
      "HOUSEHOLD_MODULES_INVALID_RESPONSE",
      "The module update response was invalid.",
      { status: response.status },
    );
  }

  return module;
}

export async function cacheHouseholdModuleCatalog(
  authSubject: string,
  householdId: string,
  catalog: readonly HouseholdModuleSnapshot[],
): Promise<void> {
  if (
    !UUID_PATTERN.test(authSubject) ||
    !UUID_PATTERN.test(householdId)
  ) {
    throw new HouseholdModulesError(
      "HOUSEHOLD_MODULES_INVALID_INPUT",
      "authSubject and householdId must be valid UUIDs.",
    );
  }

  await Promise.all(
    catalog.map((module) =>
      seedCachedRecord(authSubject, {
        householdId,
        moduleKey: "core",
        entityType: "household-module",
        entityId: module.id,
        revision: module.revision,
        data: module,
      }),
    ),
  );
}

export async function getCachedHouseholdModules(
  authSubject: string,
  householdId: string,
): Promise<readonly HouseholdModuleSnapshot[]> {
  const rows = await getCachedRecords(
    authSubject,
    householdId,
    "core",
    "household-module",
  );

  const modules = rows.map((row) => {
    const module = parseModule(row.data);
    if (
      !module ||
      module.id.toLowerCase() !==
        row.entityId.toLowerCase() ||
      module.revision !== row.revision
    ) {
      throw new HouseholdModulesError(
        "HOUSEHOLD_MODULES_CACHE_INVALID",
        "The cached module catalog is inconsistent.",
      );
    }
    return module;
  });

  modules.sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.moduleKey.localeCompare(right.moduleKey),
  );

  return Object.freeze(modules);
}
