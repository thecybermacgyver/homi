import type {
  FastifyInstance,
  FastifyRequest,
} from "fastify";
import {
  HOMI_MODULE_API_VERSION,
  defineHomiServerModule,
  type HomiModuleDatabase,
  type HomiModuleServerMutationInput,
  type HomiModuleServerMutationResult,
  type HomiRequestContext,
  type HomiServerModuleHostContext,
} from "@homi/module-sdk";
import { STARTER_MODULE_KEY } from "./constants.js";

interface StarterItemRow extends Record<string, unknown> {
  id: string;
  title: string;
  revision: string;
  deletedAt: Date | string | null;
}

interface StarterSettingRow extends Record<string, unknown> {
  boardLabel: string;
  revision: string;
}

function httpError(
  statusCode: number,
  code: string,
  message: string,
): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & {
    statusCode: number;
    code: string;
  };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function headersFor(
  request: FastifyRequest,
): Record<string, string | string[] | undefined> {
  return request.headers as Record<
    string,
    string | string[] | undefined
  >;
}

async function requestContext(
  host: HomiServerModuleHostContext,
  request: FastifyRequest,
): Promise<HomiRequestContext> {
  const context = await host.resolveContext({
    id: request.id,
    headers: headersFor(request),
  });
  await host.requireEnabled(STARTER_MODULE_KEY, context);
  return context;
}

function parseBoardLabel(body: unknown): string {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    throw httpError(
      400,
      "STARTER_SETTINGS_INVALID",
      "A JSON object is required.",
    );
  }

  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).length !== 1 ||
    typeof input.boardLabel !== "string"
  ) {
    throw httpError(
      400,
      "STARTER_SETTINGS_INVALID",
      "Only boardLabel may be supplied.",
    );
  }

  const boardLabel = input.boardLabel.trim();
  if (boardLabel.length < 1 || boardLabel.length > 80) {
    throw httpError(
      400,
      "STARTER_SETTINGS_INVALID",
      "boardLabel must contain between 1 and 80 characters.",
    );
  }
  return boardLabel;
}

function itemState(
  row: StarterItemRow,
  deleted = row.deletedAt !== null,
) {
  return Object.freeze({
    id: row.id,
    title: row.title,
    revision: row.revision,
    deleted,
  });
}

function mutationTitle(
  input: HomiModuleServerMutationInput,
): string | null {
  const keys = Object.keys(input.payload);
  if (
    keys.length !== 1 ||
    keys[0] !== "title" ||
    typeof input.payload.title !== "string"
  ) {
    return null;
  }

  const title = input.payload.title.trim();
  return title.length >= 1 && title.length <= 160
    ? title
    : null;
}

async function findItemForUpdate(
  database: HomiModuleDatabase,
  context: HomiRequestContext,
  entityId: string,
): Promise<StarterItemRow | null> {
  const result = await database.query<StarterItemRow>(
    `SELECT
       id::text AS id,
       title,
       revision::text AS revision,
       deleted_at AS "deletedAt"
     FROM mod_starter.items
     WHERE household_id = $1::uuid
       AND id = $2::uuid
     FOR UPDATE`,
    [context.householdId, entityId],
  );
  return result.rows[0] ?? null;
}

async function applyItemMutation(
  context: HomiRequestContext,
  database: HomiModuleDatabase,
  input: HomiModuleServerMutationInput,
): Promise<HomiModuleServerMutationResult> {
  if (
    input.operation !== "create" &&
    input.operation !== "update" &&
    input.operation !== "delete"
  ) {
    return {
      status: "rejected",
      revision: null,
      errorCode: "STARTER_OPERATION_UNSUPPORTED",
      serverState: null,
    };
  }

  const current = await findItemForUpdate(
    database,
    context,
    input.entityId,
  );

  if (input.operation === "create") {
    const title = mutationTitle(input);
    if (input.baseRevision !== "0" || title === null) {
      return {
        status: "rejected",
        revision: null,
        errorCode: "STARTER_CREATE_INVALID",
        serverState: null,
      };
    }

    if (current) {
      return {
        status: "conflict",
        revision: current.revision,
        errorCode: "REVISION_CONFLICT",
        serverState: itemState(current),
      };
    }

    const inserted = await database.query<StarterItemRow>(
      `INSERT INTO mod_starter.items (
         id,
         household_id,
         title,
         revision
       )
       VALUES ($1::uuid, $2::uuid, $3, 1)
       RETURNING
         id::text AS id,
         title,
         revision::text AS revision,
         deleted_at AS "deletedAt"`,
      [input.entityId, context.householdId, title],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("Starter item insert returned no row.");
    }
    return {
      status: "applied",
      revision: row.revision,
      serverState: itemState(row, false),
    };
  }

  if (!current || current.deletedAt !== null) {
    return {
      status: "rejected",
      revision: current?.revision ?? null,
      errorCode: "STARTER_ITEM_NOT_FOUND",
      serverState: current ? itemState(current) : null,
    };
  }

  if (current.revision !== input.baseRevision) {
    return {
      status: "conflict",
      revision: current.revision,
      errorCode: "REVISION_CONFLICT",
      serverState: itemState(current),
    };
  }

  if (input.operation === "update") {
    const title = mutationTitle(input);
    if (title === null) {
      return {
        status: "rejected",
        revision: current.revision,
        errorCode: "STARTER_UPDATE_INVALID",
        serverState: itemState(current),
      };
    }

    const updated = await database.query<StarterItemRow>(
      `UPDATE mod_starter.items
       SET
         title = $3,
         revision = revision + 1,
         updated_at = now()
       WHERE household_id = $1::uuid
         AND id = $2::uuid
       RETURNING
         id::text AS id,
         title,
         revision::text AS revision,
         deleted_at AS "deletedAt"`,
      [context.householdId, input.entityId, title],
    );
    const row = updated.rows[0];
    if (!row) {
      throw new Error("Starter item update returned no row.");
    }
    return {
      status: "applied",
      revision: row.revision,
      serverState: itemState(row, false),
    };
  }

  if (Object.keys(input.payload).length !== 0) {
    return {
      status: "rejected",
      revision: current.revision,
      errorCode: "STARTER_DELETE_INVALID",
      serverState: itemState(current),
    };
  }

  const deleted = await database.query<StarterItemRow>(
    `UPDATE mod_starter.items
     SET
       revision = revision + 1,
       deleted_at = now(),
       updated_at = now()
     WHERE household_id = $1::uuid
       AND id = $2::uuid
     RETURNING
       id::text AS id,
       title,
       revision::text AS revision,
       deleted_at AS "deletedAt"`,
    [context.householdId, input.entityId],
  );
  const row = deleted.rows[0];
  if (!row) {
    throw new Error("Starter item delete returned no row.");
  }
  return {
    status: "applied",
    revision: row.revision,
    serverState: itemState(row, true),
  };
}

export function createHomiServerModule(
  host: HomiServerModuleHostContext,
) {
  const database = host.moduleDatabase;

  return defineHomiServerModule({
    moduleKey: STARTER_MODULE_KEY,
    moduleApiVersion: HOMI_MODULE_API_VERSION,

    register(app: FastifyInstance) {
      app.get(
        "/api/v1/modules/starter/health",
        async (request) => {
          await requestContext(host, request);
          return {
            data: {
              moduleKey: STARTER_MODULE_KEY,
              status: "ok",
            },
          };
        },
      );

      app.get(
        "/api/v1/modules/starter/setup",
        async (request) => {
          const context = await requestContext(host, request);
          const result = await database.query<StarterSettingRow>(
            `SELECT
               board_label AS "boardLabel",
               revision::text AS revision
             FROM mod_starter.household_settings
             WHERE household_id = $1::uuid
             LIMIT 1`,
            [context.householdId],
          );

          return {
            data: result.rows[0] ?? null,
          };
        },
      );

      app.put(
        "/api/v1/modules/starter/setup",
        async (request) => {
          const context = await requestContext(host, request);
          const boardLabel = parseBoardLabel(request.body);
          const result = await database.query<StarterSettingRow>(
            `INSERT INTO mod_starter.household_settings (
               household_id,
               board_label,
               revision
             )
             VALUES ($1::uuid, $2, 1)
             ON CONFLICT (household_id)
             DO UPDATE SET
               board_label = EXCLUDED.board_label,
               revision =
                 mod_starter.household_settings.revision + 1,
               updated_at = now()
             RETURNING
               board_label AS "boardLabel",
               revision::text AS revision`,
            [context.householdId, boardLabel],
          );

          const setting = result.rows[0];
          if (!setting) {
            throw new Error(
              "Starter setup write returned no row.",
            );
          }
          return { data: setting };
        },
      );

      app.get(
        "/api/v1/modules/starter/items/:itemId",
        async (request) => {
          const context = await requestContext(host, request);
          const params = request.params as {
            itemId?: unknown;
          };
          if (
            typeof params.itemId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              params.itemId,
            )
          ) {
            throw httpError(
              400,
              "STARTER_ITEM_ID_INVALID",
              "itemId must be a valid UUID.",
            );
          }

          const result = await database.query<StarterItemRow>(
            `SELECT
               id::text AS id,
               title,
               revision::text AS revision,
               deleted_at AS "deletedAt"
             FROM mod_starter.items
             WHERE household_id = $1::uuid
               AND id = $2::uuid
               AND deleted_at IS NULL
             LIMIT 1`,
            [context.householdId, params.itemId],
          );

          const item = result.rows[0];
          if (!item) {
            throw httpError(
              404,
              "STARTER_ITEM_NOT_FOUND",
              "The Starter item was not found.",
            );
          }

          return {
            data: itemState(item, false),
          };
        },
      );
    },

    async getSetupStatus(context: HomiRequestContext) {
      const result = await database.query(
        `SELECT 1
         FROM mod_starter.household_settings
         WHERE household_id = $1::uuid
         LIMIT 1`,
        [context.householdId],
      );
      return {
        state:
          result.rows.length === 1
            ? "configured"
            : "unconfigured",
      } as const;
    },

    sync: {
      mutationHandlers: [
        {
          entityType: "item",
          operations: ["create", "update", "delete"],
          apply: applyItemMutation,
        },
      ],
    },
  });
}
