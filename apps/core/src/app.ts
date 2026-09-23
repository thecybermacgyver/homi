import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { HOMI_DB_ARCHITECTURE_VERSION } from "@homi/db";
import { HOMI_MODULE_API_VERSION } from "@homi/module-sdk";
import { fromNodeHeaders } from "better-auth/node";
import type { HomiAuthorization } from "./authorization.js";
import type { HomiClientService } from "./client.js";
import type { HomiRequestContextResolver } from "./context.js";
import type { HomiSyncService } from "./sync.js";
import type {
  HomiMemberModulePreference,
  HomiMemberModulePreferenceService,
} from "./member-module-preferences.js";
import { registerSyncRoutes } from "./sync-routes.js";
import type { HomiRuntimeModule } from "./module-host.js";
import type { HomiModuleAssetService } from "./module-assets.js";
import type { HomiModuleDirectoryService } from "./module-directory.js";
import type {
  HomiManagedModuleInstallResult,
  HomiModuleManager,
} from "./module-manager-client.js";
import type { HomiModuleSyncService } from "./module-sync.js";
import type {
  HomiHouseholdModuleService,
  HomiHouseholdModuleSummary,
  SetHomiHouseholdModuleEnabledInput,
} from "./household-modules.js";
import type {
  HomiHouseholdService,
  HomiHouseholdSettings,
  UpdateHomiHouseholdSettingsInput,
} from "./household.js";

const HOMI_CORE_VERSION = "0.0.1";
const HOMI_HTTP_API_VERSION = 1;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface HomiAuthHandler {
  handler(request: Request): Promise<Response>;
  getAuthSubject(headers: Headers): Promise<string | null>;
}

export interface HomiAppDependencies {
  checkDatabase: () => Promise<void>;
  auth: HomiAuthHandler;
  authBaseURL: string;
  requestContext: HomiRequestContextResolver;
  authorization: HomiAuthorization;
  household: HomiHouseholdService;
  client: HomiClientService;
  sync: HomiSyncService;
  moduleSync: HomiModuleSyncService;
  householdModules: HomiHouseholdModuleService;
  memberModulePreferences: HomiMemberModulePreferenceService;
  moduleAssets?: HomiModuleAssetService;
  moduleDirectory?: HomiModuleDirectoryService;
  moduleManager?: HomiModuleManager;
  onModuleInstalled?: (
    result: HomiManagedModuleInstallResult,
  ) => void;
  onModulesChanged?: () => void;
  modules?: readonly HomiRuntimeModule[];
}

function singleHeader(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function resolveContext(
  request: {
    id: string;
    headers: Record<string, string | string[] | undefined>;
  },
  dependencies: HomiAppDependencies,
) {
  const clientId = singleHeader(
    request.headers["x-homi-client-id"],
  );

  return dependencies.requestContext.resolve({
    requestId: request.id,
    headers: fromNodeHeaders(request.headers),
    householdId: singleHeader(
      request.headers["x-homi-household-id"],
    ),
    ...(clientId !== undefined ? { clientId } : {}),
  });
}

function serializeHouseholdSettings(household: HomiHouseholdSettings) {
  return {
    id: household.id,
    name: household.name,
    defaultLocale: household.defaultLocale,
    timeZone: household.timeZone,
    revision: household.revision.toString(),
  };
}

function serializeHouseholdModule(
  module: HomiHouseholdModuleSummary,
) {
  return {
    id: module.id,
    moduleKey: module.moduleKey,
    name: module.name,
    publisher: module.publisher,
    version: module.version,
    globalState: module.globalState,
    available: module.available,
    enabled: module.enabled,
    revision: module.revision.toString(),
    setupRequired: module.setupRequired,
    setupState: module.setupState,
  };
}

function serializeMemberModulePreference(
  preference: HomiMemberModulePreference,
) {
  return {
    id: preference.id,
    moduleId: preference.moduleId,
    moduleKey: preference.moduleKey,
    surfaceId: preference.surfaceId,
    label: preference.label,
    visible: preference.visible,
    displayOrder: preference.displayOrder,
    revision: preference.revision.toString(),
  };
}

function validationError(message: string): never {
  const error = new Error(message) as Error & {
    statusCode: number;
    code: string;
  };
  error.statusCode = 400;
  error.code = "VALIDATION_FAILED";
  throw error;
}

function parseClientRegistration(body: unknown) {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    validationError("A JSON object is required.");
  }

  const input = body as Record<string, unknown>;
  const allowed = new Set([
    "clientInstanceId",
    "label",
    "platform",
    "appVersion",
  ]);

  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      validationError(`Unknown field '${key}'.`);
    }
  }

  if (
    typeof input.clientInstanceId !== "string" ||
    !UUID_PATTERN.test(input.clientInstanceId)
  ) {
    validationError("clientInstanceId must be a valid UUID.");
  }

  const result: {
    clientInstanceId: string;
    label?: string;
    platform?: string;
    appVersion?: string;
  } = {
    clientInstanceId: input.clientInstanceId,
  };

  for (const key of ["label", "platform", "appVersion"] as const) {
    const value = input[key];

    if (value === undefined) {
      continue;
    }

    if (typeof value !== "string") {
      validationError(`${key} must be a string.`);
    }

    const trimmed = value.trim();

    if (trimmed.length < 1 || trimmed.length > 120) {
      validationError(
        `${key} must contain between 1 and 120 characters.`,
      );
    }

    result[key] = trimmed;
  }

  return result;
}

function parseHouseholdSettingsUpdate(
  body: unknown,
): UpdateHomiHouseholdSettingsInput {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    validationError("A JSON object is required.");
  }

  const input = body as Record<string, unknown>;
  const allowedKeys = new Set([
    "baseRevision",
    "name",
    "defaultLocale",
    "timeZone",
  ]);

  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      validationError(`Unknown field '${key}'.`);
    }
  }

  if (
    typeof input.baseRevision !== "string" ||
    !/^[1-9][0-9]*$/.test(input.baseRevision)
  ) {
    validationError(
      "baseRevision must be a positive integer encoded as a string.",
    );
  }

  const parsed: UpdateHomiHouseholdSettingsInput = {
    baseRevision: BigInt(input.baseRevision),
  };

  let changeCount = 0;

  if (input.name !== undefined) {
    if (typeof input.name !== "string") {
      validationError("name must be a string.");
    }

    const name = input.name.trim();

    if (name.length < 1 || name.length > 120) {
      validationError(
        "name must contain between 1 and 120 characters.",
      );
    }

    parsed.name = name;
    changeCount += 1;
  }

  if (input.defaultLocale !== undefined) {
    if (typeof input.defaultLocale !== "string") {
      validationError("defaultLocale must be a string.");
    }

    let locale: string | undefined;

    try {
      locale = Intl.getCanonicalLocales(input.defaultLocale)[0];
    } catch {
      validationError("defaultLocale must be a valid locale.");
    }

    if (!locale) {
      validationError("defaultLocale must be a valid locale.");
    }

    parsed.defaultLocale = locale;
    changeCount += 1;
  }

  if (input.timeZone !== undefined) {
    if (typeof input.timeZone !== "string") {
      validationError("timeZone must be a string.");
    }

    try {
      new Intl.DateTimeFormat("en", {
        timeZone: input.timeZone,
      }).format();
    } catch {
      validationError("timeZone must be a valid IANA timezone.");
    }

    parsed.timeZone = input.timeZone;
    changeCount += 1;
  }

  if (changeCount === 0) {
    validationError(
      "At least one household setting must be supplied.",
    );
  }

  return parsed;
}

function parseHouseholdModuleStateUpdate(
  body: unknown,
): SetHomiHouseholdModuleEnabledInput {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    validationError("A JSON object is required.");
  }

  const input = body as Record<string, unknown>;
  const keys = Object.keys(input);
  if (
    keys.length !== 2 ||
    !Object.hasOwn(input, "enabled") ||
    !Object.hasOwn(input, "baseRevision")
  ) {
    validationError(
      "Only enabled and baseRevision are accepted.",
    );
  }

  if (typeof input.enabled !== "boolean") {
    validationError("enabled must be a boolean.");
  }

  if (
    typeof input.baseRevision !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(input.baseRevision)
  ) {
    validationError(
      "baseRevision must be a non-negative integer encoded as a string.",
    );
  }

  const baseRevision = BigInt(input.baseRevision);
  if (baseRevision > 9223372036854775807n) {
    validationError("baseRevision exceeds BIGINT range.");
  }

  return {
    enabled: input.enabled,
    baseRevision,
  };
}

export function buildApp(
  dependencies: HomiAppDependencies,
): FastifyInstance {
  const app = Fastify({
    logger: true,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Request-ID", request.id);
    return payload;
  });

  app.get("/health/live", async () => ({
    status: "ok",
    service: "homi-core",
    version: HOMI_CORE_VERSION,
  }));

  app.get("/health/ready", async (request, reply) => {
    try {
      await dependencies.checkDatabase();

      return {
        status: "ready",
        service: "homi-core",
        checks: {
          process: "ok",
          database: "ok",
        },
      };
    } catch (error) {
      request.log.error(
        { err: error },
        "Homi Core database readiness check failed",
      );

      return reply.code(503).send({
        status: "not_ready",
        service: "homi-core",
        checks: {
          process: "ok",
          database: "unavailable",
        },
      });
    }
  });

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, dependencies.authBaseURL);
      const headers = fromNodeHeaders(request.headers);

      const body =
        request.method !== "GET" && request.body !== undefined
          ? typeof request.body === "string"
            ? request.body
            : JSON.stringify(request.body)
          : undefined;

      const authRequest = new Request(url, {
        method: request.method,
        headers,
        ...(body !== undefined ? { body } : {}),
      });

      const response = await dependencies.auth.handler(authRequest);

      reply.status(response.status);

      response.headers.forEach((value, key) => {
        reply.header(key, value);
      });

      return reply.send(response.body ? await response.text() : null);
    },
  });

  app.get("/api/v1/core/version", async () => ({
    data: {
      name: "Homi Core",
      coreVersion: HOMI_CORE_VERSION,
      httpApiVersion: HOMI_HTTP_API_VERSION,
      moduleApiVersion: HOMI_MODULE_API_VERSION,
      databaseArchitectureVersion: HOMI_DB_ARCHITECTURE_VERSION,
    },
  }));

  app.post(
    "/api/v1/core/sync/clients/register",
    async (request) => {
      const headers = fromNodeHeaders(request.headers);
      const authSubject =
        await dependencies.auth.getAuthSubject(headers);

      if (!authSubject) {
        const error = new Error(
          "Authentication is required.",
        ) as Error & {
          statusCode: number;
          code: string;
        };
        error.statusCode = 401;
        error.code = "AUTHENTICATION_REQUIRED";
        throw error;
      }

      const input = parseClientRegistration(request.body);
      const client = await dependencies.client.register(
        authSubject,
        input,
      );

      return {
        data: {
          authSubject,
          ...client,
          lastSeenAt: client.lastSeenAt.toISOString(),
        },
      };
    },
  );

  app.get("/api/v1/core/households", async (request, reply) => {
    const authSubject = await dependencies.auth.getAuthSubject(
      fromNodeHeaders(request.headers),
    );

    if (!authSubject) {
      const error = new Error("Authentication is required.") as Error & {
        statusCode: number;
        code: string;
      };
      error.statusCode = 401;
      error.code = "AUTHENTICATION_REQUIRED";
      throw error;
    }

    const discovery = await dependencies.household.discover(authSubject);
    reply.header("Cache-Control", "no-store");
    return { data: discovery };
  });

  app.get("/api/v1/core/context", async (request) => {
    const context = await resolveContext(request, dependencies);

    return {
      data: context,
    };
  });

  app.get("/api/v1/core/permissions", async (request) => {
    const context = await resolveContext(request, dependencies);
    const permissions =
      await dependencies.authorization.listPermissions(context);

    return {
      data: {
        permissions,
      },
    };
  });

  app.get(
    "/api/v1/core/household/settings",
    async (request) => {
      const context = await resolveContext(request, dependencies);

      await dependencies.authorization.requirePermission(
        context,
        "core.household.admin",
      );

      const household =
        await dependencies.household.getSettings(context);

      return {
        data: serializeHouseholdSettings(household),
      };
    },
  );

  app.patch(
    "/api/v1/core/household/settings",
    async (request) => {
      const context = await resolveContext(request, dependencies);

      await dependencies.authorization.requirePermission(
        context,
        "core.household.admin",
      );

      const input = parseHouseholdSettingsUpdate(request.body);
      const household =
        await dependencies.household.updateSettings(context, input);

      return {
        data: serializeHouseholdSettings(household),
      };
    },
  );

  app.get("/api/v1/core/module-directory", async (request, reply) => {
    await resolveContext(request, dependencies);
    if (!dependencies.moduleDirectory) {
      return reply.code(503).send({
        error: {
          code: "MODULE_DIRECTORY_NOT_CONFIGURED",
          message: "The trusted Homi module directory is not configured.",
        },
      });
    }
    const directory = await dependencies.moduleDirectory.list();
    return { data: directory };
  });

  app.post(
    "/api/v1/core/module-directory/:moduleKey/install",
    async (request) => {
      const context = await resolveContext(request, dependencies);
      await dependencies.authorization.requirePermission(
        context,
        "core.household.admin",
      );

      if (!dependencies.moduleDirectory || !dependencies.moduleManager) {
        throw Object.assign(
          new Error("Managed module installation is not configured."),
          {
            statusCode: 503,
            code: "MODULE_INSTALL_NOT_CONFIGURED",
          },
        );
      }

      const params = request.params as { moduleKey?: unknown };
      if (
        typeof params.moduleKey !== "string" ||
        !/^[a-z][a-z0-9-]{1,63}$/.test(params.moduleKey)
      ) {
        validationError("moduleKey is invalid.");
      }

      const directory = await dependencies.moduleDirectory.list();
      const entry = directory.entries.find(
        (candidate) => candidate.moduleKey === params.moduleKey,
      );
      if (!entry) {
        throw Object.assign(
          new Error("The module is not in the trusted directory."),
          { statusCode: 404, code: "MODULE_DIRECTORY_ENTRY_NOT_FOUND" },
        );
      }
      if (entry.revoked) {
        throw Object.assign(
          new Error("This module release has been revoked."),
          { statusCode: 409, code: "MODULE_DIRECTORY_ENTRY_REVOKED" },
        );
      }

      const result = await dependencies.moduleManager.install(entry);
      dependencies.onModuleInstalled?.(result);
      return { data: { ...result, restarting: true } };
    },
  );

  app.delete(
    "/api/v1/core/modules/:moduleKey",
    async (request) => {
      const context = await resolveContext(request, dependencies);
      await dependencies.authorization.requirePermission(
        context,
        "core.household.admin",
      );
      if (!dependencies.moduleManager) {
        throw Object.assign(
          new Error("Managed module uninstall is not configured."),
          {
            statusCode: 503,
            code: "MODULE_UNINSTALL_NOT_CONFIGURED",
          },
        );
      }
      const params = request.params as { moduleKey?: unknown };
      if (
        typeof params.moduleKey !== "string" ||
        !/^[a-z][a-z0-9-]{1,63}$/.test(params.moduleKey)
      ) {
        validationError("moduleKey is invalid.");
      }

      const result = await dependencies.moduleManager.uninstall(
        params.moduleKey,
      );
      dependencies.onModulesChanged?.();
      return { data: { ...result, restarting: true } };
    },
  );

  app.get("/api/v1/core/modules", async (request) => {
    const context = await resolveContext(request, dependencies);
    const [modules, canManage] = await Promise.all([
      dependencies.householdModules.list(context),
      dependencies.authorization.hasPermission(
        context,
        "core.household.admin",
      ),
    ]);

    return {
      data: {
        modules: modules.map(serializeHouseholdModule),
        canManage,
      },
    };
  });

  app.get(
    "/api/v1/core/module-preferences",
    async (request) => {
      const context = await resolveContext(request, dependencies);
      const preferences =
        await dependencies.memberModulePreferences.list(context);

      return {
        data: {
          preferences: preferences.map(
            serializeMemberModulePreference,
          ),
        },
      };
    },
  );

  app.patch(
    "/api/v1/core/modules/:moduleKey",
    async (request) => {
      const context = await resolveContext(request, dependencies);

      await dependencies.authorization.requirePermission(
        context,
        "core.household.admin",
      );

      const params = request.params as { moduleKey?: unknown };
      if (
        typeof params.moduleKey !== "string" ||
        !/^[a-z][a-z0-9-]{1,63}$/.test(params.moduleKey)
      ) {
        validationError("moduleKey is invalid.");
      }

      const input = parseHouseholdModuleStateUpdate(request.body);
      const module = await dependencies.householdModules.setEnabled(
        context,
        params.moduleKey,
        input,
      );

      return {
        data: serializeHouseholdModule(module),
      };
    },
  );

  app.get("/api/v1/core/module-runtime", async (request) => {
    const context = await resolveContext(request, dependencies);
    return {
      data: {
        modules:
          await dependencies.householdModules.runtime(context),
      },
    };
  });

  const moduleAssets = dependencies.moduleAssets;
  if (moduleAssets) {
    app.get(
      "/api/v1/core/module-assets/:moduleKey/:version/*",
      async (request, reply) => {
        const params = request.params as {
          moduleKey?: unknown;
          version?: unknown;
          "*"?: unknown;
        };

        if (
          typeof params.moduleKey !== "string" ||
          typeof params.version !== "string" ||
          typeof params["*"] !== "string"
        ) {
          validationError("The module asset path is invalid.");
        }

        const asset = await moduleAssets.read(
          params.moduleKey,
          params.version,
          params["*"],
        );

        return reply
          .type(asset.contentType)
          .header(
            "Cache-Control",
            "private, max-age=31536000, immutable",
          )
          .send(asset.body);
      },
    );
  }

  registerSyncRoutes(app, dependencies);

  for (const module of dependencies.modules ?? []) {
    module.register(app);
  }

  app.setNotFoundHandler(async (request, reply) => {
    return reply.code(404).send({
      error: {
        code: "RESOURCE_NOT_FOUND",
        message: "The requested resource was not found.",
        requestId: request.id,
      },
    });
  });

  app.setErrorHandler(async (error, request, reply) => {
    request.log.error({ err: error }, "Unhandled request error");

    const httpError =
      typeof error === "object" && error !== null
        ? (error as {
            statusCode?: unknown;
            code?: unknown;
            message?: unknown;
          })
        : {};

    const statusCode =
      typeof httpError.statusCode === "number" &&
      httpError.statusCode >= 400 &&
      httpError.statusCode <= 599
        ? httpError.statusCode
        : 500;

    const code =
      typeof httpError.code === "string"
        ? httpError.code
        : statusCode >= 500
          ? "INTERNAL_ERROR"
          : "VALIDATION_FAILED";

    const message =
      statusCode >= 500
        ? "An internal server error occurred."
        : typeof httpError.message === "string"
          ? httpError.message
          : "The request could not be processed.";

    return reply.code(statusCode).send({
      error: {
        code,
        message,
        requestId: request.id,
      },
    });
  });

  return app;
}
