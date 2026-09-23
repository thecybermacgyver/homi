import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import type { HomiAppDependencies } from "./app.js";
import type {
  HomiHouseholdSyncPayload,
  HomiSyncMutationInput,
} from "./sync.js";
import type {
  HomiMemberModulePreferenceMutationInput,
  HomiMemberModulePreferencePayload,
} from "./member-module-preferences.js";
import type {
  HomiModuleSyncMutationInput,
} from "./module-sync.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function singleHeader(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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

function parseCursorBody(body: unknown): bigint {
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
    keys.length !== 1 ||
    keys[0] !== "lastChangeSequence"
  ) {
    validationError(
      "Only lastChangeSequence may be supplied.",
    );
  }

  if (
    typeof input.lastChangeSequence !== "string" ||
    !/^[0-9]+$/.test(input.lastChangeSequence)
  ) {
    validationError(
      "lastChangeSequence must be a non-negative integer encoded as a string.",
    );
  }

  return BigInt(input.lastChangeSequence);
}

function parseHouseholdPayload(
  value: unknown,
): HomiHouseholdSyncPayload {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    validationError("payload must be a JSON object.");
  }

  const input = value as Record<string, unknown>;
  const allowed = new Set([
    "name",
    "defaultLocale",
    "timeZone",
  ]);

  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      validationError(`Unknown payload field '${key}'.`);
    }
  }

  const payload: HomiHouseholdSyncPayload = {};
  let changeCount = 0;

  if (input.name !== undefined) {
    if (typeof input.name !== "string") {
      validationError("payload.name must be a string.");
    }

    const name = input.name.trim();

    if (name.length < 1 || name.length > 120) {
      validationError(
        "payload.name must contain between 1 and 120 characters.",
      );
    }

    payload.name = name;
    changeCount += 1;
  }

  if (input.defaultLocale !== undefined) {
    if (typeof input.defaultLocale !== "string") {
      validationError(
        "payload.defaultLocale must be a string.",
      );
    }

    let locale: string | undefined;

    try {
      locale = Intl.getCanonicalLocales(
        input.defaultLocale,
      )[0];
    } catch {
      validationError(
        "payload.defaultLocale must be a valid locale.",
      );
    }

    if (!locale) {
      validationError(
        "payload.defaultLocale must be a valid locale.",
      );
    }

    payload.defaultLocale = locale;
    changeCount += 1;
  }

  if (input.timeZone !== undefined) {
    if (typeof input.timeZone !== "string") {
      validationError(
        "payload.timeZone must be a string.",
      );
    }

    try {
      new Intl.DateTimeFormat("en", {
        timeZone: input.timeZone,
      }).format();
    } catch {
      validationError(
        "payload.timeZone must be a valid IANA timezone.",
      );
    }

    payload.timeZone = input.timeZone;
    changeCount += 1;
  }

  if (changeCount === 0) {
    validationError(
      "payload must contain at least one household setting.",
    );
  }

  return payload;
}

function parseMemberModulePreferencePayload(
  value: unknown,
): HomiMemberModulePreferencePayload {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    validationError("payload must be a JSON object.");
  }

  const input = value as Record<string, unknown>;
  const allowed = new Set(["visible", "displayOrder"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      validationError(`Unknown payload field '${key}'.`);
    }
  }

  const payload: { visible?: boolean; displayOrder?: number } = {};
  if (input.visible !== undefined) {
    if (typeof input.visible !== "boolean") {
      validationError("payload.visible must be a boolean.");
    }
    payload.visible = input.visible;
  }
  if (input.displayOrder !== undefined) {
    if (
      !Number.isSafeInteger(input.displayOrder) ||
      (input.displayOrder as number) < 0 ||
      (input.displayOrder as number) > 2147483647
    ) {
      validationError(
        "payload.displayOrder must be a non-negative 32-bit integer.",
      );
    }
    payload.displayOrder = input.displayOrder as number;
  }
  if (Object.keys(payload).length === 0) {
    validationError(
      "payload must contain visible or displayOrder.",
    );
  }
  return payload;
}

type ParsedSyncMutation =
  | {
      readonly kind: "core";
      readonly input: HomiSyncMutationInput;
    }
  | {
      readonly kind: "core-preference";
      readonly input: HomiMemberModulePreferenceMutationInput;
    }
  | {
      readonly kind: "module";
      readonly input: HomiModuleSyncMutationInput;
    };

function parseMutationBody(body: unknown): ParsedSyncMutation {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    validationError("A JSON object is required.");
  }

  const input = body as Record<string, unknown>;
  const allowed = new Set([
    "clientMutationId",
    "moduleKey",
    "entityType",
    "entityId",
    "operation",
    "baseRevision",
    "payload",
  ]);

  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      validationError(`Unknown field '${key}'.`);
    }
  }

  if (
    typeof input.clientMutationId !== "string" ||
    !UUID_PATTERN.test(input.clientMutationId)
  ) {
    validationError(
      "clientMutationId must be a valid UUID.",
    );
  }

  if (
    typeof input.moduleKey !== "string" ||
    !/^[a-z][a-z0-9-]{1,63}$/.test(input.moduleKey)
  ) {
    validationError("moduleKey is invalid.");
  }

  if (
    typeof input.entityType !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(input.entityType)
  ) {
    validationError("entityType is invalid.");
  }

  if (
    typeof input.entityId !== "string" ||
    !UUID_PATTERN.test(input.entityId)
  ) {
    validationError("entityId must be a valid UUID.");
  }

  if (
    input.operation !== "create" &&
    input.operation !== "update" &&
    input.operation !== "delete"
  ) {
    validationError(
      "operation must be create, update, or delete.",
    );
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

  if (
    typeof input.payload !== "object" ||
    input.payload === null ||
    Array.isArray(input.payload)
  ) {
    validationError("payload must be a JSON object.");
  }

  if (input.moduleKey === "core") {
    if (input.operation !== "update") {
      validationError("Core sync supports only update operations.");
    }
    if (baseRevision < 1n) {
      validationError("Core baseRevision must be positive.");
    }

    if (input.entityType === "household") {
      return {
        kind: "core",
        input: {
          clientMutationId: input.clientMutationId,
          moduleKey: "core",
          entityType: "household",
          entityId: input.entityId,
          operation: "update",
          baseRevision,
          payload: parseHouseholdPayload(input.payload),
        },
      };
    }

    if (input.entityType === "member-module-preference") {
      return {
        kind: "core-preference",
        input: {
          clientMutationId: input.clientMutationId,
          entityId: input.entityId,
          baseRevision,
          payload: parseMemberModulePreferencePayload(input.payload),
        },
      };
    }

    validationError(
      "Core sync entityType must be household or member-module-preference.",
    );
  }

  return {
    kind: "module",
    input: {
      clientMutationId: input.clientMutationId,
      moduleKey: input.moduleKey,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      baseRevision,
      payload: { ...input.payload },
    },
  };
}

async function resolveSyncContext(
  request: {
    id: string;
    headers: Record<string, string | string[] | undefined>;
  },
  dependencies: HomiAppDependencies,
) {
  const householdId = singleHeader(
    request.headers["x-homi-household-id"],
  );
  const clientId = singleHeader(
    request.headers["x-homi-client-id"],
  );

  return dependencies.requestContext.resolve({
    requestId: request.id,
    headers: fromNodeHeaders(request.headers),
    householdId,
    ...(clientId !== undefined ? { clientId } : {}),
  });
}

export function registerSyncRoutes(
  app: FastifyInstance,
  dependencies: HomiAppDependencies,
): void {
  app.get("/api/v1/core/sync/changes", async (request) => {
    const query = request.query as Record<string, unknown>;

    const allowed = new Set(["after", "limit"]);
    for (const key of Object.keys(query)) {
      if (!allowed.has(key)) {
        validationError(
          `Unknown query parameter '${key}'.`,
        );
      }
    }

    const afterValue = query.after ?? "0";
    if (
      typeof afterValue !== "string" ||
      !/^[0-9]+$/.test(afterValue)
    ) {
      validationError(
        "after must be a non-negative integer.",
      );
    }

    let limit = 100;
    if (query.limit !== undefined) {
      if (
        typeof query.limit !== "string" ||
        !/^[1-9][0-9]*$/.test(query.limit)
      ) {
        validationError(
          "limit must be a positive integer.",
        );
      }

      limit = Number.parseInt(query.limit, 10);
      if (limit < 1 || limit > 500) {
        validationError(
          "limit must be between 1 and 500.",
        );
      }
    }

    const context = await resolveSyncContext(
      request,
      dependencies,
    );

    const page = await dependencies.sync.getChanges(
      context,
      BigInt(afterValue),
      limit,
    );

    return {
      data: page,
    };
  });

  app.get("/api/v1/core/sync/status", async (request) => {
    const context = await resolveSyncContext(
      request,
      dependencies,
    );

    return {
      data: await dependencies.sync.getStatus(context),
    };
  });

  app.post("/api/v1/core/sync/cursor", async (request) => {
    const context = await resolveSyncContext(
      request,
      dependencies,
    );

    const lastChangeSequence = parseCursorBody(
      request.body,
    );

    return {
      data: await dependencies.sync.acknowledgeCursor(
        context,
        lastChangeSequence,
      ),
    };
  });

  app.post(
    "/api/v1/core/sync/mutations",
    async (request) => {
      const context = await resolveSyncContext(
        request,
        dependencies,
      );

      const mutation = parseMutationBody(request.body);

      if (mutation.kind === "core") {
        await dependencies.authorization.requirePermission(
          context,
          "core.household.admin",
        );

        return {
          data: await dependencies.sync.applyMutation(
            context,
            mutation.input,
          ),
        };
      }

      if (mutation.kind === "core-preference") {
        return {
          data:
            await dependencies.memberModulePreferences.applyMutation(
              context,
              mutation.input,
            ),
        };
      }

      return {
        data: await dependencies.moduleSync.applyMutation(
          context,
          mutation.input,
        ),
      };
    },
  );
}
