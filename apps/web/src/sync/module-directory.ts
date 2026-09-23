const MODULE_KEY = /^[a-z][a-z0-9-]{1,63}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface ModuleDirectoryEntry {
  readonly moduleKey: string;
  readonly name: string;
  readonly publisher: string;
  readonly description: string;
  readonly latestVersion: string;
  readonly artifactUrl: string;
  readonly packageDigest: string;
  readonly sourceUrl: string;
  readonly requestedPermissions: readonly string[];
  readonly publishedAt: string;
  readonly revoked: boolean;
}

export interface ModuleDirectory {
  readonly generatedAt: string;
  readonly keyId: string;
  readonly entries: readonly ModuleDirectoryEntry[];
}

export interface ManagedModuleInstallResult {
  readonly moduleKey: string;
  readonly version: string;
  readonly status: "installed" | "already-installed";
  readonly fromVersion: string | null;
  readonly packageDigest: string;
  readonly backupId: string;
  readonly restarting: boolean;
}
export interface ManagedModuleUninstallResult {
  readonly moduleKey: string;
  readonly version: string;
  readonly backupId: string;
  readonly dataPreserved: true;
  readonly restarting: boolean;
}

export class ModuleDirectoryError extends Error {
  readonly status: number | undefined;

  constructor(
    public readonly code: string,
    message: string,
    options: ErrorOptions & { status?: number } = {},
  ) {
    super(message, options);
    this.name = "ModuleDirectoryError";
    this.status = options.status;
  }
}

function object(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function errorResponse(
  response: Response,
  body: unknown,
): never {
  const error = object(body) ? body.error : undefined;
  throw new ModuleDirectoryError(
    object(error) && text(error.code)
      ? error.code
      : "MODULE_DIRECTORY_REQUEST_FAILED",
    object(error) && typeof error.message === "string"
      ? error.message
      : "The trusted module directory request failed.",
    { status: response.status },
  );
}

async function request(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<{ response: Response; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: "same-origin",
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    throw new ModuleDirectoryError(
      "MODULE_DIRECTORY_TRANSPORT_FAILED",
      "The trusted module directory could not be reached.",
      { cause },
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ModuleDirectoryError(
      "MODULE_DIRECTORY_INVALID_RESPONSE",
      "The trusted module directory response was invalid.",
      { status: response.status, cause },
    );
  }
  if (!response.ok) errorResponse(response, body);
  return { response, body };
}

function parseEntry(value: unknown): ModuleDirectoryEntry {
  if (
    !object(value) ||
    !text(value.moduleKey) ||
    !MODULE_KEY.test(value.moduleKey) ||
    !text(value.name) ||
    !text(value.publisher) ||
    !text(value.description) ||
    !text(value.latestVersion) ||
    !VERSION.test(value.latestVersion) ||
    !text(value.artifactUrl) ||
    !text(value.packageDigest) ||
    !DIGEST.test(value.packageDigest) ||
    !text(value.sourceUrl) ||
    !Array.isArray(value.requestedPermissions) ||
    !value.requestedPermissions.every(text) ||
    !text(value.publishedAt) ||
    typeof value.revoked !== "boolean"
  ) {
    throw new ModuleDirectoryError(
      "MODULE_DIRECTORY_INVALID_RESPONSE",
      "The trusted module directory contains an invalid entry.",
    );
  }

  return Object.freeze({
    moduleKey: value.moduleKey,
    name: value.name,
    publisher: value.publisher,
    description: value.description,
    latestVersion: value.latestVersion,
    artifactUrl: value.artifactUrl,
    packageDigest: value.packageDigest,
    sourceUrl: value.sourceUrl,
    requestedPermissions: Object.freeze(
      [...value.requestedPermissions] as string[],
    ),
    publishedAt: value.publishedAt,
    revoked: value.revoked,
  });
}

export async function fetchModuleDirectory(
  input: {
    readonly householdId: string;
    readonly clientId: string;
  },
  signal?: AbortSignal,
): Promise<ModuleDirectory> {
  const { response, body } = await request(
    "/api/v1/core/module-directory",
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
    object(body) && Object.keys(body).length === 1
      ? body.data
      : undefined;
  if (
    !object(data) ||
    data.schemaVersion !== 1 ||
    !text(data.generatedAt) ||
    !Array.isArray(data.entries) ||
    !text(data.keyId)
  ) {
    throw new ModuleDirectoryError(
      "MODULE_DIRECTORY_INVALID_RESPONSE",
      "The trusted module directory response was invalid.",
      { status: response.status },
    );
  }

  return Object.freeze({
    generatedAt: data.generatedAt,
    keyId: data.keyId,
    entries: Object.freeze(data.entries.map(parseEntry)),
  });
}

export async function uninstallModule(
  input: {
    readonly householdId: string;
    readonly clientId: string;
    readonly moduleKey: string;
  },
): Promise<ManagedModuleUninstallResult> {
  const { response, body } = await request(
    "/api/v1/core/modules/" + encodeURIComponent(input.moduleKey),
    {
      method: "DELETE",
      headers: {
        "X-Homi-Household-ID": input.householdId,
        "X-Homi-Client-ID": input.clientId,
      },
    },
  );
  const data = object(body) && Object.keys(body).length === 1
    ? body.data
    : undefined;
  if (
    !object(data) ||
    data.moduleKey !== input.moduleKey ||
    !text(data.version) ||
    !text(data.backupId) ||
    data.dataPreserved !== true ||
    typeof data.restarting !== "boolean"
  ) {
    throw new ModuleDirectoryError(
      "MODULE_UNINSTALL_INVALID_RESPONSE",
      "The managed module uninstall response was invalid.",
      { status: response.status },
    );
  }
  return Object.freeze({
    moduleKey: data.moduleKey,
    version: data.version,
    backupId: data.backupId,
    dataPreserved: true as const,
    restarting: data.restarting,
  });
}

export async function installDirectoryModule(
  input: {
    readonly householdId: string;
    readonly clientId: string;
    readonly moduleKey: string;
  },
): Promise<ManagedModuleInstallResult> {
  if (!MODULE_KEY.test(input.moduleKey)) {
    throw new ModuleDirectoryError(
      "MODULE_INSTALL_INVALID_INPUT",
      "The module key is invalid.",
    );
  }

  const { response, body } = await request(
    "/api/v1/core/module-directory/" +
      encodeURIComponent(input.moduleKey) +
      "/install",
    {
      method: "POST",
      headers: {
        "X-Homi-Household-ID": input.householdId,
        "X-Homi-Client-ID": input.clientId,
      },
    },
  );

  const data =
    object(body) && Object.keys(body).length === 1
      ? body.data
      : undefined;
  if (
    !object(data) ||
    data.moduleKey !== input.moduleKey ||
    !text(data.version) ||
    (data.status !== "installed" &&
      data.status !== "already-installed") ||
    (typeof data.fromVersion !== "string" &&
      data.fromVersion !== null) ||
    !text(data.packageDigest) ||
    !DIGEST.test(data.packageDigest) ||
    !text(data.backupId) ||
    typeof data.restarting !== "boolean"
  ) {
    throw new ModuleDirectoryError(
      "MODULE_INSTALL_INVALID_RESPONSE",
      "The managed module installation response was invalid.",
      { status: response.status },
    );
  }

  return Object.freeze({
    moduleKey: data.moduleKey,
    version: data.version,
    status: data.status,
    fromVersion: data.fromVersion,
    packageDigest: data.packageDigest,
    backupId: data.backupId,
    restarting: data.restarting,
  });
}
