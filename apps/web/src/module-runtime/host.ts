import {
  deleteCachedRecord,
  getCachedRecords,
  seedCachedRecord,
} from "../sync/local-db.js";
import {
  HOMI_MODULE_API_VERSION,
  assertHomiModuleCompatibility,
  defineHomiWebModule,
  parseHomiModuleManifest,
  type HomiModuleManifest,
  type HomiWebModuleDefinition,
  type HomiWebModuleHostContext,
} from "@homi/module-sdk";

export type HomiModuleRuntimeSetupState =
  | "not-required"
  | "configured"
  | "unconfigured"
  | "unavailable";

export interface HomiModuleRuntimeDescriptor {
  readonly id: string;
  readonly moduleKey: string;
  readonly revision: string;
  readonly enabled: boolean;
  readonly manifest: Readonly<HomiModuleManifest>;
  readonly webEntrypointUrl: string;
  readonly setupState: HomiModuleRuntimeSetupState;
}

export interface LoadedHomiWebModule {
  readonly descriptor: HomiModuleRuntimeDescriptor;
  readonly definition: Readonly<HomiWebModuleDefinition>;
}

export interface HomiWebModuleLoadFailure {
  readonly moduleKey: string;
  readonly message: string;
}

export interface HomiWebModuleLoadResult {
  readonly modules: readonly LoadedHomiWebModule[];
  readonly failures: readonly HomiWebModuleLoadFailure[];
}

interface HomiWebEntrypoint {
  createHomiWebModule?: (
    context: HomiWebModuleHostContext,
  ) =>
    | HomiWebModuleDefinition
    | Promise<HomiWebModuleDefinition>;
}

export class HomiWebModuleHostError extends Error {
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
    this.name = "HomiWebModuleHostError";
    this.status = options.status;
    this.requestId = options.requestId;
  }
}

function record(
  value: unknown,
): Record<string, unknown> | null {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  )
    ? value as Record<string, unknown>
    : null;
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

function setupState(
  value: unknown,
): value is HomiModuleRuntimeSetupState {
  return (
    value === "not-required" ||
    value === "configured" ||
    value === "unconfigured" ||
    value === "unavailable"
  );
}

function parseDescriptor(
  value: unknown,
): HomiModuleRuntimeDescriptor {
  const input = record(value);
  if (
    !input ||
    !exactKeys(input, [
      "id",
      "moduleKey",
      "revision",
      "enabled",
      "manifest",
      "webEntrypointUrl",
      "setupState",
    ]) ||
    typeof input.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id) ||
    typeof input.moduleKey !== "string" ||
    typeof input.revision !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(input.revision) ||
    typeof input.enabled !== "boolean" ||
    typeof input.webEntrypointUrl !== "string" ||
    !setupState(input.setupState)
  ) {
    throw new HomiWebModuleHostError(
      "MODULE_RUNTIME_INVALID_RESPONSE",
      "The module runtime catalog contained an invalid module descriptor.",
    );
  }

  const manifest = parseHomiModuleManifest(input.manifest);
  assertHomiModuleCompatibility(
    manifest,
    HOMI_MODULE_API_VERSION,
  );

  if (
    manifest.moduleKey !== input.moduleKey ||
    !manifest.entrypoints.web ||
    !input.webEntrypointUrl.startsWith(
      "/api/v1/core/module-assets/",
    )
  ) {
    throw new HomiWebModuleHostError(
      "MODULE_RUNTIME_INVALID_RESPONSE",
      "The module runtime descriptor does not match its manifest.",
    );
  }

  return Object.freeze({
    id: input.id,
    moduleKey: input.moduleKey,
    revision: input.revision,
    enabled: input.enabled,
    manifest,
    webEntrypointUrl: input.webEntrypointUrl,
    setupState: input.setupState,
  });
}

function copyError(
  response: Response,
  body: unknown,
): never {
  const envelope = record(body);
  const error = record(envelope?.error);

  if (
    error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    throw new HomiWebModuleHostError(
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

  throw new HomiWebModuleHostError(
    "MODULE_RUNTIME_INVALID_RESPONSE",
    "The module runtime request failed with an invalid error response.",
    { status: response.status },
  );
}

export async function fetchHomiModuleRuntime(
  input: {
    readonly householdId: string;
    readonly clientId: string;
  },
  signal?: AbortSignal,
): Promise<readonly HomiModuleRuntimeDescriptor[]> {
  let response: Response;

  try {
    signal?.throwIfAborted();
    response = await fetch(
      "/api/v1/core/module-runtime",
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
  } catch (cause) {
    throw new HomiWebModuleHostError(
      "MODULE_RUNTIME_TRANSPORT_FAILED",
      "The module runtime catalog could not be loaded.",
      { cause },
    );
  }

  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (cause) {
    throw new HomiWebModuleHostError(
      "MODULE_RUNTIME_INVALID_RESPONSE",
      "The module runtime catalog was not valid JSON.",
      { status: response.status, cause },
    );
  }

  if (!response.ok) {
    copyError(response, body);
  }

  const envelope = record(body);
  const data = record(envelope?.data);
  if (
    !envelope ||
    !exactKeys(envelope, ["data"]) ||
    !data ||
    !exactKeys(data, ["modules"]) ||
    !Array.isArray(data.modules)
  ) {
    throw new HomiWebModuleHostError(
      "MODULE_RUNTIME_INVALID_RESPONSE",
      "The module runtime catalog response was invalid.",
      { status: response.status },
    );
  }

  const descriptors = data.modules.map(parseDescriptor);
  const keys = new Set<string>();

  for (const descriptor of descriptors) {
    if (keys.has(descriptor.moduleKey)) {
      throw new HomiWebModuleHostError(
        "MODULE_RUNTIME_DUPLICATE_MODULE",
        "The module runtime catalog contained a duplicate module.",
      );
    }
    keys.add(descriptor.moduleKey);
  }

  return Object.freeze(descriptors);
}

export async function cacheHomiModuleRuntime(
  authSubject: string,
  householdId: string,
  descriptors: readonly HomiModuleRuntimeDescriptor[],
): Promise<void> {
  const existing = await getCachedRecords(
    authSubject,
    householdId,
    "core",
    "module-runtime",
  );
  const currentIds = new Set(
    descriptors.map((descriptor) =>
      descriptor.id.toLowerCase()
    ),
  );

  await Promise.all(
    descriptors.map((descriptor) =>
      seedCachedRecord(authSubject, {
        householdId,
        moduleKey: "core",
        entityType: "module-runtime",
        entityId: descriptor.id,
        revision: descriptor.revision,
        data: descriptor,
      }),
    ),
  );

  await Promise.all(
    existing
      .filter(
        (row) =>
          !currentIds.has(row.entityId.toLowerCase()),
      )
      .map((row) =>
        deleteCachedRecord(
          authSubject,
          householdId,
          {
            moduleKey: "core",
            entityType: "module-runtime",
            entityId: row.entityId,
          },
        ),
      ),
  );
}

export async function getCachedHomiModuleRuntime(
  authSubject: string,
  householdId: string,
): Promise<readonly HomiModuleRuntimeDescriptor[]> {
  const rows = await getCachedRecords(
    authSubject,
    householdId,
    "core",
    "module-runtime",
  );

  const descriptors: HomiModuleRuntimeDescriptor[] = [];
  const invalidRows = [];
  for (const row of rows) {
    try {
      const descriptor = parseDescriptor(row.data);
      if (
        descriptor.id.toLowerCase() !== row.entityId.toLowerCase() ||
        descriptor.revision !== row.revision
      ) {
        invalidRows.push(row);
        continue;
      }
      descriptors.push(descriptor);
    } catch {
      invalidRows.push(row);
    }
  }
  if (invalidRows.length > 0) {
    await Promise.all(
      invalidRows.map((row) =>
        deleteCachedRecord(
          authSubject,
          householdId,
          {
            moduleKey: "core",
            entityType: "module-runtime",
            entityId: row.entityId,
          },
        ),
      ),
    );
  }

  descriptors.sort(
    (left, right) =>
      left.manifest.name.localeCompare(
        right.manifest.name,
      ) ||
      left.moduleKey.localeCompare(right.moduleKey),
  );

  return Object.freeze(descriptors);
}

function validateDefinition(
  descriptor: HomiModuleRuntimeDescriptor,
  value: HomiWebModuleDefinition,
): Readonly<HomiWebModuleDefinition> {
  const definition = defineHomiWebModule(value);
  const manifest = descriptor.manifest;

  if (
    definition.moduleKey !== descriptor.moduleKey ||
    definition.moduleApiVersion !== manifest.moduleApiVersion
  ) {
    throw new HomiWebModuleHostError(
      "MODULE_RUNTIME_CONTRACT_MISMATCH",
      `Module '${descriptor.moduleKey}' returned runtime identity that does not match its manifest.`,
    );
  }

  const navigationIds = new Set(
    manifest.navigation.map((item) => item.id),
  );
  for (const item of manifest.navigation) {
    if (!definition.pages[item.id]) {
      throw new HomiWebModuleHostError(
        "MODULE_RUNTIME_PAGE_MISSING",
        `Module '${descriptor.moduleKey}' does not provide declared page '${item.id}'.`,
      );
    }
  }

  for (const pageId of Object.keys(definition.pages)) {
    if (!navigationIds.has(pageId)) {
      throw new HomiWebModuleHostError(
        "MODULE_RUNTIME_PAGE_UNDECLARED",
        `Module '${descriptor.moduleKey}' provided undeclared page '${pageId}'.`,
      );
    }
  }

  if (
    manifest.setup?.required === true &&
    definition.setup === undefined
  ) {
    throw new HomiWebModuleHostError(
      "MODULE_RUNTIME_SETUP_MISSING",
      `Module '${descriptor.moduleKey}' requires setup but provides no setup surface.`,
    );
  }

  if (
    manifest.settings?.household === true &&
    definition.settings?.household === undefined
  ) {
    throw new HomiWebModuleHostError(
      "MODULE_RUNTIME_HOUSEHOLD_SETTINGS_MISSING",
      `Module '${descriptor.moduleKey}' declares household settings but provides no household settings surface.`,
    );
  }

  if (
    manifest.settings?.user === true &&
    definition.settings?.user === undefined
  ) {
    throw new HomiWebModuleHostError(
      "MODULE_RUNTIME_USER_SETTINGS_MISSING",
      `Module '${descriptor.moduleKey}' declares user settings but provides no user settings surface.`,
    );
  }

  const declaredBoardSurfaces = new Map(
    manifest.extensions.familyBoard.map(
      (item) => [item.surfaceId, item] as const,
    ),
  );
  const boardSurfaces = definition.familyBoard ?? {};

  for (const item of manifest.extensions.familyBoard) {
    if (!boardSurfaces[item.surfaceId]) {
      throw new HomiWebModuleHostError(
        "MODULE_RUNTIME_FAMILY_BOARD_SURFACE_MISSING",
        `Module '${descriptor.moduleKey}' does not provide declared Family Board surface '${item.surfaceId}'.`,
      );
    }
  }

  for (const surfaceId of Object.keys(boardSurfaces)) {
    if (!declaredBoardSurfaces.has(surfaceId)) {
      throw new HomiWebModuleHostError(
        "MODULE_RUNTIME_FAMILY_BOARD_SURFACE_UNDECLARED",
        `Module '${descriptor.moduleKey}' provided undeclared Family Board surface '${surfaceId}'.`,
      );
    }
  }

  const declaredEntities = new Map(
    (manifest.sync?.entities ?? []).map(
      (entity) => [entity.entityType, entity] as const,
    ),
  );
  const handlers = definition.sync?.changeHandlers ?? [];
  const adapters = definition.sync?.mutationAdapters ?? [];

  for (const handler of handlers) {
    if (
      handler.moduleKey !== descriptor.moduleKey ||
      !declaredEntities.has(handler.entityType)
    ) {
      throw new HomiWebModuleHostError(
        "MODULE_RUNTIME_SYNC_HANDLER_UNDECLARED",
        `Module '${descriptor.moduleKey}' provided an undeclared sync change handler.`,
      );
    }
  }

  for (const adapter of adapters) {
    const declared = declaredEntities.get(adapter.entityType);
    if (
      adapter.moduleKey !== descriptor.moduleKey ||
      !declared ||
      adapter.operations.some(
        (operation) =>
          !declared.operations.includes(
            operation as "create" | "update" | "delete",
          ),
      )
    ) {
      throw new HomiWebModuleHostError(
        "MODULE_RUNTIME_MUTATION_ADAPTER_UNDECLARED",
        `Module '${descriptor.moduleKey}' provided an undeclared mutation adapter.`,
      );
    }
  }

  for (const entity of declaredEntities.values()) {
    const handlerCount = handlers.filter(
      (handler) =>
        handler.entityType === entity.entityType,
    ).length;
    if (handlerCount !== 1) {
      throw new HomiWebModuleHostError(
        "MODULE_RUNTIME_SYNC_HANDLER_MISSING",
        `Module '${descriptor.moduleKey}' must provide exactly one change handler for '${entity.entityType}'.`,
      );
    }

    for (const operation of entity.operations) {
      const ownerCount = adapters.filter(
        (adapter) =>
          adapter.entityType === entity.entityType &&
          adapter.operations.includes(operation),
      ).length;
      if (ownerCount !== 1) {
        throw new HomiWebModuleHostError(
          "MODULE_RUNTIME_MUTATION_ADAPTER_MISSING",
          `Module '${descriptor.moduleKey}' must provide exactly one mutation adapter for '${entity.entityType}/${operation}'.`,
        );
      }
    }
  }

  return definition;
}

function failureMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The module could not be loaded.";
}

const moduleImportFailureAttempts = new Map<string, number>();

function moduleImportUrl(
  descriptor: HomiModuleRuntimeDescriptor,
): { readonly key: string; readonly url: string } {
  const key = `${descriptor.moduleKey}:${descriptor.webEntrypointUrl}`;
  const attempt = moduleImportFailureAttempts.get(key) ?? 0;
  if (attempt === 0) {
    return Object.freeze({ key, url: descriptor.webEntrypointUrl });
  }
  const separator = descriptor.webEntrypointUrl.includes("?") ? "&" : "?";
  return Object.freeze({
    key,
    url: `${descriptor.webEntrypointUrl}${separator}homi_retry=${attempt}`,
  });
}

export async function loadHomiWebModules(
  descriptors: readonly HomiModuleRuntimeDescriptor[],
  context: HomiWebModuleHostContext,
): Promise<HomiWebModuleLoadResult> {
  const modules: LoadedHomiWebModule[] = [];
  const failures: HomiWebModuleLoadFailure[] = [];
  for (const descriptor of descriptors) {
    const importTarget = moduleImportUrl(descriptor);
    try {
      const imported =
        await import(
          /* @vite-ignore */
          importTarget.url
        ) as HomiWebEntrypoint;

      if (
        typeof imported.createHomiWebModule !== "function"
      ) {
        throw new HomiWebModuleHostError(
          "MODULE_RUNTIME_FACTORY_MISSING",
          `Module '${descriptor.moduleKey}' does not export createHomiWebModule().`,
        );
      }

      const definition = validateDefinition(
        descriptor,
        await imported.createHomiWebModule(context),
      );

      moduleImportFailureAttempts.delete(importTarget.key);
      modules.push(
        Object.freeze({
          descriptor,
          definition,
        }),
      );
    } catch (error) {
      moduleImportFailureAttempts.set(
        importTarget.key,
        (moduleImportFailureAttempts.get(importTarget.key) ?? 0) + 1,
      );
      failures.push(
        Object.freeze({
          moduleKey: descriptor.moduleKey,
          message: failureMessage(error),
        }),
      );
    }
  }

  return Object.freeze({
    modules: Object.freeze(modules),
    failures: Object.freeze(failures),
  });
}
