export const HOMI_MODULE_MANIFEST_SCHEMA_VERSION = 1 as const;

export type HomiCoreCapability =
  | "audit"
  | "files"
  | "household-people"
  | "jobs"
  | "localization"
  | "notifications"
  | "secrets"
  | "sync";

export type HomiSyncOperation = "create" | "update" | "delete";

export interface HomiModuleEntrypoints {
  server?: string;
  web?: string;
}

export interface HomiModuleDatabaseManifest {
  schema: string;
  migrations: string;
}

export interface HomiModuleNavigationManifest {
  id: string;
  label: string;
  path: string;
  icon?: string;
}

export interface HomiModuleSetupManifest {
  required: boolean;
  scope: "household" | "user";
}

export interface HomiModuleSettingsManifest {
  household: boolean;
  user: boolean;
}

export interface HomiModuleLocalizationManifest {
  defaultLocale: string;
  resources: string;
}

export interface HomiModuleSyncEntityManifest {
  entityType: string;
  operations: readonly HomiSyncOperation[];
}

export interface HomiModuleSyncManifest {
  entities: readonly HomiModuleSyncEntityManifest[];
}

export interface HomiModuleBrokerManifest {
  provides: readonly string[];
  consumes: readonly string[];
}

export type HomiFamilyBoardSlot =
  | "weather-overview"
  | "meal-planner"
  | "noticeboard"
  | "grocery-inventory"
  | "chore-board"
  | "family-schedule";

export interface HomiModuleFamilyBoardManifest {
  surfaceId: string;
  label: string;
  slot: HomiFamilyBoardSlot;
}

export interface HomiModuleExtensionManifest {
  familyBoard: readonly HomiModuleFamilyBoardManifest[];
  householdSettings: boolean;
  notifications: boolean;
  search: boolean;
}

export interface HomiModuleManifest {
  schemaVersion: typeof HOMI_MODULE_MANIFEST_SCHEMA_VERSION;
  moduleKey: string;
  name: string;
  publisher: string;
  version: string;
  moduleApiVersion: number;
  description?: string;
  entrypoints: HomiModuleEntrypoints;
  database?: HomiModuleDatabaseManifest;
  coreCapabilities: readonly HomiCoreCapability[];
  requestedPermissions: readonly string[];
  navigation: readonly HomiModuleNavigationManifest[];
  setup?: HomiModuleSetupManifest;
  settings?: HomiModuleSettingsManifest;
  localization?: HomiModuleLocalizationManifest;
  sync?: HomiModuleSyncManifest;
  broker?: HomiModuleBrokerManifest;
  extensions: HomiModuleExtensionManifest;
}


export class HomiModuleCompatibilityError extends Error {
  readonly code = "INCOMPATIBLE_HOMI_MODULE_API";

  constructor(message: string) {
    super(message);
    this.name = "HomiModuleCompatibilityError";
  }
}

export function assertHomiModuleCompatibility(
  manifest: Readonly<HomiModuleManifest>,
  supportedApiVersion: number,
): void {
  if (
    !Number.isSafeInteger(supportedApiVersion) ||
    supportedApiVersion < 1
  ) {
    throw new HomiModuleCompatibilityError(
      "supportedApiVersion must be a positive integer.",
    );
  }

  if (manifest.moduleApiVersion !== supportedApiVersion) {
    throw new HomiModuleCompatibilityError(
      `Module '${manifest.moduleKey}' requires Homi module API ${manifest.moduleApiVersion}; this host supports API ${supportedApiVersion}.`,
    );
  }
}

export class HomiModuleManifestError extends Error {
  readonly code = "INVALID_HOMI_MODULE_MANIFEST";

  constructor(message: string) {
    super(message);
    this.name = "HomiModuleManifestError";
  }
}

const MODULE_KEY = /^[a-z][a-z0-9-]{1,63}$/;
const IDENTIFIER = /^[a-z][a-z0-9-]{0,63}$/;
const PERMISSION = /^[a-z][a-z0-9.-]{1,127}$/;
const CAPABILITY = /^[a-z][a-z0-9.-]{1,127}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

const CORE_CAPABILITIES = new Set<HomiCoreCapability>([
  "audit",
  "files",
  "household-people",
  "jobs",
  "localization",
  "notifications",
  "secrets",
  "sync",
]);

const SYNC_OPERATIONS = new Set<HomiSyncOperation>([
  "create",
  "update",
  "delete",
]);

const FAMILY_BOARD_SLOTS = new Set<HomiFamilyBoardSlot>([
  "weather-overview",
  "meal-planner",
  "noticeboard",
  "grocery-inventory",
  "chore-board",
  "family-schedule",
]);

function assertKnownKeys(
  input: Record<string, unknown>,
  field: string,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(input)) {
    if (!allowedSet.has(key)) {
      throw new HomiModuleManifestError(
        `${field} contains unknown field '${key}'.`,
      );
    }
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HomiModuleManifestError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  field: string,
  pattern?: RegExp,
): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new HomiModuleManifestError(
      `${field} must be a non-empty trimmed string.`,
    );
  }
  if (pattern && !pattern.test(value)) {
    throw new HomiModuleManifestError(`${field} has an invalid format.`);
  }
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new HomiModuleManifestError(`${field} must be a boolean.`);
  }
  return value;
}

function array(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new HomiModuleManifestError(`${field} must be an array.`);
  }
  return value;
}

function safePackagePath(value: unknown, field: string): string {
  const path = text(value, field);
  if (
    !path.startsWith("./") ||
    path.includes("\\") ||
    path.split("/").includes("..")
  ) {
    throw new HomiModuleManifestError(
      `${field} must be a relative package path without traversal.`,
    );
  }
  return path;
}

function uniqueStrings(
  values: readonly unknown[],
  field: string,
  pattern: RegExp,
): readonly string[] {
  const result = values.map((value, index) =>
    text(value, `${field}[${index}]`, pattern),
  );
  if (new Set(result).size !== result.length) {
    throw new HomiModuleManifestError(`${field} contains duplicate values.`);
  }
  return Object.freeze(result);
}

function parseEntrypoints(value: unknown): HomiModuleEntrypoints {
  const input = record(value, "entrypoints");
  assertKnownKeys(input, "entrypoints", ["server", "web"]);
  const server =
    input.server === undefined
      ? undefined
      : safePackagePath(input.server, "entrypoints.server");
  const web =
    input.web === undefined
      ? undefined
      : safePackagePath(input.web, "entrypoints.web");

  if (server === undefined && web === undefined) {
    throw new HomiModuleManifestError(
      "entrypoints must declare at least one server or web entrypoint.",
    );
  }

  return Object.freeze({
    ...(server !== undefined ? { server } : {}),
    ...(web !== undefined ? { web } : {}),
  });
}

function parseDatabase(
  value: unknown,
  moduleKey: string,
): HomiModuleDatabaseManifest {
  const input = record(value, "database");
  assertKnownKeys(input, "database", ["schema", "migrations"]);
  const schema = text(input.schema, "database.schema");

  if (schema !== `mod_${moduleKey.replaceAll("-", "_")}`) {
    throw new HomiModuleManifestError(
      `database.schema must be 'mod_${moduleKey.replaceAll("-", "_")}'.`,
    );
  }

  return Object.freeze({
    schema,
    migrations: safePackagePath(input.migrations, "database.migrations"),
  });
}

function parseNavigation(
  value: unknown,
  moduleKey: string,
): readonly HomiModuleNavigationManifest[] {
  const items = array(value, "navigation");
  const ids = new Set<string>();
  const paths = new Set<string>();

  const result = items.map((item, index) => {
    const input = record(item, `navigation[${index}]`);
    assertKnownKeys(
      input,
      `navigation[${index}]`,
      ["id", "label", "path", "icon"],
    );
    const id = text(input.id, `navigation[${index}].id`, IDENTIFIER);
    const label = text(input.label, `navigation[${index}].label`);
    const path = text(input.path, `navigation[${index}].path`);

    const moduleBasePath = `/modules/${moduleKey}`;
    if (
      path !== moduleBasePath &&
      !path.startsWith(`${moduleBasePath}/`)
    ) {
      throw new HomiModuleManifestError(
        `navigation[${index}].path must be inside /modules/${moduleKey}.`,
      );
    }
    if (ids.has(id)) {
      throw new HomiModuleManifestError("navigation IDs must be unique.");
    }
    if (paths.has(path)) {
      throw new HomiModuleManifestError("navigation paths must be unique.");
    }

    ids.add(id);
    paths.add(path);

    const icon =
      input.icon === undefined
        ? undefined
        : text(input.icon, `navigation[${index}].icon`, IDENTIFIER);

    return Object.freeze({
      id,
      label,
      path,
      ...(icon !== undefined ? { icon } : {}),
    });
  });

  return Object.freeze(result);
}

function parseSetup(value: unknown): HomiModuleSetupManifest {
  const input = record(value, "setup");
  assertKnownKeys(input, "setup", ["required", "scope"]);
  const scope = text(input.scope, "setup.scope");
  if (scope !== "household" && scope !== "user") {
    throw new HomiModuleManifestError(
      "setup.scope must be 'household' or 'user'.",
    );
  }

  return Object.freeze({
    required: boolean(input.required, "setup.required"),
    scope,
  });
}

function parseSettings(value: unknown): HomiModuleSettingsManifest {
  const input = record(value, "settings");
  assertKnownKeys(input, "settings", ["household", "user"]);
  return Object.freeze({
    household: boolean(input.household, "settings.household"),
    user: boolean(input.user, "settings.user"),
  });
}

function parseLocalization(value: unknown): HomiModuleLocalizationManifest {
  const input = record(value, "localization");
  assertKnownKeys(input, "localization", ["defaultLocale", "resources"]);
  return Object.freeze({
    defaultLocale: text(
      input.defaultLocale,
      "localization.defaultLocale",
      LOCALE,
    ),
    resources: safePackagePath(
      input.resources,
      "localization.resources",
    ),
  });
}

function parseSync(value: unknown): HomiModuleSyncManifest {
  const input = record(value, "sync");
  assertKnownKeys(input, "sync", ["entities"]);
  const entities = array(input.entities, "sync.entities");
  const entityTypes = new Set<string>();

  const parsed = entities.map((entity, index) => {
    const item = record(entity, `sync.entities[${index}]`);
    assertKnownKeys(
      item,
      `sync.entities[${index}]`,
      ["entityType", "operations"],
    );
    const entityType = text(
      item.entityType,
      `sync.entities[${index}].entityType`,
      IDENTIFIER,
    );

    if (entityTypes.has(entityType)) {
      throw new HomiModuleManifestError(
        "sync.entities contains duplicate entity types.",
      );
    }
    entityTypes.add(entityType);

    const operations = uniqueStrings(
      array(item.operations, `sync.entities[${index}].operations`),
      `sync.entities[${index}].operations`,
      IDENTIFIER,
    );

    for (const operation of operations) {
      if (!SYNC_OPERATIONS.has(operation as HomiSyncOperation)) {
        throw new HomiModuleManifestError(
          `Unsupported sync operation '${operation}'.`,
        );
      }
    }

    return Object.freeze({
      entityType,
      operations: Object.freeze(
        operations as readonly HomiSyncOperation[],
      ),
    });
  });

  return Object.freeze({ entities: Object.freeze(parsed) });
}

function parseBroker(value: unknown): HomiModuleBrokerManifest {
  const input = record(value, "broker");
  assertKnownKeys(input, "broker", ["provides", "consumes"]);
  return Object.freeze({
    provides: uniqueStrings(
      array(input.provides, "broker.provides"),
      "broker.provides",
      CAPABILITY,
    ),
    consumes: uniqueStrings(
      array(input.consumes, "broker.consumes"),
      "broker.consumes",
      CAPABILITY,
    ),
  });
}

function parseExtensions(value: unknown): HomiModuleExtensionManifest {
  const input = record(value, "extensions");
  assertKnownKeys(
    input,
    "extensions",
    ["familyBoard", "householdSettings", "notifications", "search"],
  );

  const surfaceIds = new Set<string>();
  const familyBoard = array(
    input.familyBoard,
    "extensions.familyBoard",
  ).map((value, index) => {
    const item = record(
      value,
      `extensions.familyBoard[${index}]`,
    );
    assertKnownKeys(
      item,
      `extensions.familyBoard[${index}]`,
      ["surfaceId", "label", "slot"],
    );

    const surfaceId = text(
      item.surfaceId,
      `extensions.familyBoard[${index}].surfaceId`,
      IDENTIFIER,
    );
    const label =
      item.label === undefined
        ? surfaceId
        : text(
            item.label,
            `extensions.familyBoard[${index}].label`,
          );
    const slot = text(
      item.slot,
      `extensions.familyBoard[${index}].slot`,
    ) as HomiFamilyBoardSlot;

    if (!FAMILY_BOARD_SLOTS.has(slot)) {
      throw new HomiModuleManifestError(
        `extensions.familyBoard[${index}].slot is not a supported Homi Family Board slot.`,
      );
    }
    if (surfaceIds.has(surfaceId)) {
      throw new HomiModuleManifestError(
        "extensions.familyBoard surface IDs must be unique.",
      );
    }
    surfaceIds.add(surfaceId);

    return Object.freeze({
      surfaceId,
      label,
      slot,
    });
  });

  return Object.freeze({
    familyBoard: Object.freeze(familyBoard),
    householdSettings: boolean(
      input.householdSettings,
      "extensions.householdSettings",
    ),
    notifications: boolean(
      input.notifications,
      "extensions.notifications",
    ),
    search: boolean(input.search, "extensions.search"),
  });
}

export function parseHomiModuleManifest(
  value: unknown,
): Readonly<HomiModuleManifest> {
  const input = record(value, "manifest");
  assertKnownKeys(
    input,
    "manifest",
    [
      "schemaVersion",
      "moduleKey",
      "name",
      "publisher",
      "version",
      "moduleApiVersion",
      "description",
      "entrypoints",
      "database",
      "coreCapabilities",
      "requestedPermissions",
      "navigation",
      "setup",
      "settings",
      "localization",
      "sync",
      "broker",
      "extensions",
    ],
  );

  if (input.schemaVersion !== HOMI_MODULE_MANIFEST_SCHEMA_VERSION) {
    throw new HomiModuleManifestError(
      `schemaVersion must be ${HOMI_MODULE_MANIFEST_SCHEMA_VERSION}.`,
    );
  }

  const moduleKey = text(input.moduleKey, "moduleKey", MODULE_KEY);
  const version = text(input.version, "version", SEMVER);
  const moduleApiVersion = input.moduleApiVersion;

  if (
    typeof moduleApiVersion !== "number" ||
    !Number.isSafeInteger(moduleApiVersion) ||
    moduleApiVersion < 1
  ) {
    throw new HomiModuleManifestError(
      "moduleApiVersion must be a positive integer.",
    );
  }

  const coreCapabilities = uniqueStrings(
    array(input.coreCapabilities, "coreCapabilities"),
    "coreCapabilities",
    IDENTIFIER,
  );

  for (const capability of coreCapabilities) {
    if (!CORE_CAPABILITIES.has(capability as HomiCoreCapability)) {
      throw new HomiModuleManifestError(
        `Unsupported Core capability '${capability}'.`,
      );
    }
  }

  const requestedPermissions = uniqueStrings(
    array(input.requestedPermissions, "requestedPermissions"),
    "requestedPermissions",
    PERMISSION,
  );

  const description =
    input.description === undefined
      ? undefined
      : text(input.description, "description");

  const database =
    input.database === undefined
      ? undefined
      : parseDatabase(input.database, moduleKey);
  const setup =
    input.setup === undefined ? undefined : parseSetup(input.setup);
  const settings =
    input.settings === undefined
      ? undefined
      : parseSettings(input.settings);
  const localization =
    input.localization === undefined
      ? undefined
      : parseLocalization(input.localization);
  const sync =
    input.sync === undefined ? undefined : parseSync(input.sync);
  const broker =
    input.broker === undefined ? undefined : parseBroker(input.broker);

  return Object.freeze({
    schemaVersion: HOMI_MODULE_MANIFEST_SCHEMA_VERSION,
    moduleKey,
    name: text(input.name, "name"),
    publisher: text(input.publisher, "publisher"),
    version,
    moduleApiVersion,
    ...(description !== undefined ? { description } : {}),
    entrypoints: parseEntrypoints(input.entrypoints),
    ...(database !== undefined ? { database } : {}),
    coreCapabilities: Object.freeze(
      coreCapabilities as readonly HomiCoreCapability[],
    ),
    requestedPermissions,
    navigation: parseNavigation(input.navigation, moduleKey),
    ...(setup !== undefined ? { setup } : {}),
    ...(settings !== undefined ? { settings } : {}),
    ...(localization !== undefined ? { localization } : {}),
    ...(sync !== undefined ? { sync } : {}),
    ...(broker !== undefined ? { broker } : {}),
    extensions: parseExtensions(input.extensions),
  });
}
