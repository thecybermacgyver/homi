import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  HOMI_MODULE_API_VERSION,
  defineHomiServerModule,
  type HomiModuleDatabase,
  type HomiModuleServerMutationInput,
  type HomiModuleServerMutationResult,
  type HomiRequestContext,
  type HomiServerModuleHostContext,
} from "@homi/module-sdk";
import { SHOPPING_MODULE_KEY, inferAisle } from "./constants.js";
import type { ShoppingItem } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ItemRow extends Record<string, unknown> {
  id: string;
  name: string;
  quantity: string;
  store: string;
  aisle: string;
  assignedTo: string | null;
  checked: boolean;
  checkedBy: string | null;
  checkedAt: string | Date | null;
  revision: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt: string | Date | null;
}

function httpError(statusCode: number, code: string, message: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

function iso(value: string | Date | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function state(row: ItemRow, deleted = row.deletedAt !== null): ShoppingItem {
  return Object.freeze({
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    store: row.store,
    aisle: row.aisle,
    assignedTo: row.assignedTo,
    checked: row.checked,
    checkedBy: row.checkedBy,
    checkedAt: iso(row.checkedAt),
    revision: row.revision,
    createdAt: iso(row.createdAt) ?? "",
    updatedAt: iso(row.updatedAt) ?? "",
    deleted,
  });
}

function headers(request: FastifyRequest) {
  return request.headers as Record<string, string | string[] | undefined>;
}

async function contextFor(
  host: HomiServerModuleHostContext,
  request: FastifyRequest,
): Promise<HomiRequestContext> {
  const context = await host.resolveContext({ id: request.id, headers: headers(request) });
  await host.requireEnabled(SHOPPING_MODULE_KEY, context);
  return context;
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") {
    throw httpError(400, "SHOPPING_INPUT_INVALID", field + " must be text.");
  }
  const result = value.trim();
  if (result.length < 1 || result.length > maximum) {
    throw httpError(400, "SHOPPING_INPUT_INVALID", field + " has an invalid length.");
  }
  return result;
}

function optionalPerson(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !UUID.test(value)) {
    throw httpError(400, "SHOPPING_INPUT_INVALID", "assignedTo must be a household person.");
  }
  return value;
}

interface ItemInput {
  name: string;
  quantity: string;
  store: string;
  aisle: string;
  assignedTo: string | null;
  checked: boolean;
}

function parseItemPayload(payload: Readonly<Record<string, unknown>>): ItemInput {
  const keys = ["name", "quantity", "store", "aisle", "assignedTo", "checked"];
  if (
    Object.keys(payload).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(payload, key)) ||
    typeof payload.checked !== "boolean"
  ) {
    throw httpError(400, "SHOPPING_INPUT_INVALID", "The shopping item payload is invalid.");
  }
  const name = text(payload.name, "name", 160);
  const requestedAisle =
    typeof payload.aisle === "string" ? payload.aisle.trim() : "";
  return {
    name,
    quantity: text(payload.quantity, "quantity", 40),
    store: text(payload.store, "store", 100),
    aisle: requestedAisle === "" || requestedAisle === "Automatic"
      ? inferAisle(name)
      : text(requestedAisle, "aisle", 100),
    assignedTo: optionalPerson(payload.assignedTo),
    checked: payload.checked,
  };
}

const selection = `
  id::text AS id,
  name,
  quantity,
  store,
  aisle,
  assigned_to::text AS "assignedTo",
  checked,
  checked_by::text AS "checkedBy",
  checked_at AS "checkedAt",
  revision::text AS revision,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  deleted_at AS "deletedAt"`;

async function findForUpdate(
  database: HomiModuleDatabase,
  householdId: string,
  entityId: string,
): Promise<ItemRow | null> {
  const result = await database.query<ItemRow>(
    `SELECT ${selection}
     FROM mod_shopping.items
     WHERE household_id = $1::uuid AND id = $2::uuid
     FOR UPDATE`,
    [householdId, entityId],
  );
  return result.rows[0] ?? null;
}

async function validateAssignee(
  host: HomiServerModuleHostContext,
  context: HomiRequestContext,
  assignedTo: string | null,
): Promise<boolean> {
  if (assignedTo === null) return true;
  if (!host.householdPeople) return false;
  const people = await host.householdPeople.listActive(context);
  return people.some((person) => person.id === assignedTo);
}

async function applyItemMutation(
  context: HomiRequestContext,
  database: HomiModuleDatabase,
  input: HomiModuleServerMutationInput,
  host: HomiServerModuleHostContext,
): Promise<HomiModuleServerMutationResult> {
  if (!["create", "update", "delete"].includes(input.operation)) {
    return { status: "rejected", revision: null, errorCode: "SHOPPING_OPERATION_UNSUPPORTED", serverState: null };
  }
  const current = await findForUpdate(database, context.householdId, input.entityId);

  if (input.operation === "create") {
    let item: ItemInput;
    try {
      item = parseItemPayload(input.payload);
    } catch {
      return { status: "rejected", revision: null, errorCode: "SHOPPING_CREATE_INVALID", serverState: null };
    }
    if (
      input.baseRevision !== "0" ||
      current !== null ||
      !(await validateAssignee(host, context, item.assignedTo))
    ) {
      return current
        ? { status: "conflict", revision: current.revision, errorCode: "REVISION_CONFLICT", serverState: state(current) }
        : { status: "rejected", revision: null, errorCode: "SHOPPING_CREATE_INVALID", serverState: null };
    }
    const inserted = await database.query<ItemRow>(
      `INSERT INTO mod_shopping.items (
         id, household_id, name, quantity, store, aisle, assigned_to,
         checked, checked_by, checked_at, revision
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid,
         $8, CASE WHEN $8 THEN $9::uuid ELSE NULL END,
         CASE WHEN $8 THEN now() ELSE NULL END, 1
       ) RETURNING ${selection}`,
      [
        input.entityId, context.householdId, item.name, item.quantity,
        item.store, item.aisle, item.assignedTo, item.checked,
        context.householdPersonId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("Shopping item insert returned no row.");
    return { status: "applied", revision: row.revision, serverState: state(row, false) };
  }

  if (!current || current.deletedAt !== null) {
    return {
      status: "rejected",
      revision: current?.revision ?? null,
      errorCode: "SHOPPING_ITEM_NOT_FOUND",
      serverState: current ? state(current) : null,
    };
  }
  if (current.revision !== input.baseRevision) {
    return { status: "conflict", revision: current.revision, errorCode: "REVISION_CONFLICT", serverState: state(current) };
  }

  if (input.operation === "update") {
    let item: ItemInput;
    try {
      item = parseItemPayload(input.payload);
    } catch {
      return { status: "rejected", revision: current.revision, errorCode: "SHOPPING_UPDATE_INVALID", serverState: state(current) };
    }
    if (!(await validateAssignee(host, context, item.assignedTo))) {
      return { status: "rejected", revision: current.revision, errorCode: "SHOPPING_ASSIGNEE_INVALID", serverState: state(current) };
    }
    const updated = await database.query<ItemRow>(
      `UPDATE mod_shopping.items SET
         name = $3, quantity = $4, store = $5, aisle = $6,
         assigned_to = $7::uuid, checked = $8,
         checked_by = CASE WHEN $8 THEN $9::uuid ELSE NULL END,
         checked_at = CASE
           WHEN $8 AND NOT checked THEN now()
           WHEN $8 THEN checked_at
           ELSE NULL
         END,
         revision = revision + 1,
         updated_at = now()
       WHERE household_id = $1::uuid AND id = $2::uuid
       RETURNING ${selection}`,
      [
        context.householdId, input.entityId, item.name, item.quantity,
        item.store, item.aisle, item.assignedTo, item.checked,
        context.householdPersonId,
      ],
    );
    const row = updated.rows[0];
    if (!row) throw new Error("Shopping item update returned no row.");
    return { status: "applied", revision: row.revision, serverState: state(row, false) };
  }

  if (Object.keys(input.payload).length !== 0) {
    return { status: "rejected", revision: current.revision, errorCode: "SHOPPING_DELETE_INVALID", serverState: state(current) };
  }
  const deleted = await database.query<ItemRow>(
    `UPDATE mod_shopping.items
     SET revision = revision + 1, deleted_at = now(), updated_at = now()
     WHERE household_id = $1::uuid AND id = $2::uuid
     RETURNING ${selection}`,
    [context.householdId, input.entityId],
  );
  const row = deleted.rows[0];
  if (!row) throw new Error("Shopping item delete returned no row.");
  return { status: "applied", revision: row.revision, serverState: state(row, true) };
}

export function createHomiServerModule(host: HomiServerModuleHostContext) {
  const database = host.moduleDatabase;
  return defineHomiServerModule({
    moduleKey: SHOPPING_MODULE_KEY,
    moduleApiVersion: HOMI_MODULE_API_VERSION,

    register(app: FastifyInstance) {
      app.get("/api/v1/modules/shopping/health", async (request) => {
        await contextFor(host, request);
        return { data: { moduleKey: SHOPPING_MODULE_KEY, status: "ok" } };
      });

      app.get("/api/v1/modules/shopping/people", async (request) => {
        const context = await contextFor(host, request);
        if (!host.householdPeople) {
          throw httpError(503, "SHOPPING_PEOPLE_UNAVAILABLE", "Household people are unavailable.");
        }
        return { data: await host.householdPeople.listActive(context) };
      });

      app.get("/api/v1/modules/shopping/items", async (request) => {
        const context = await contextFor(host, request);
        const result = await database.query<ItemRow>(
          `SELECT ${selection}
           FROM mod_shopping.items
           WHERE household_id = $1::uuid AND deleted_at IS NULL
           ORDER BY checked, lower(store), lower(aisle), created_at`,
          [context.householdId],
        );
        return { data: result.rows.map((row) => state(row, false)) };
      });

      app.get("/api/v1/modules/shopping/items/:itemId", async (request) => {
        const context = await contextFor(host, request);
        const itemId = (request.params as { itemId?: unknown }).itemId;
        if (typeof itemId !== "string" || !UUID.test(itemId)) {
          throw httpError(400, "SHOPPING_ITEM_ID_INVALID", "itemId must be a UUID.");
        }
        const result = await database.query<ItemRow>(
          `SELECT ${selection}
           FROM mod_shopping.items
           WHERE household_id = $1::uuid AND id = $2::uuid
             AND deleted_at IS NULL
           LIMIT 1`,
          [context.householdId, itemId],
        );
        const item = result.rows[0];
        if (!item) throw httpError(404, "SHOPPING_ITEM_NOT_FOUND", "The shopping item was not found.");
        return { data: state(item, false) };
      });
    },

    sync: {
      mutationHandlers: [{
        entityType: "item",
        operations: ["create", "update", "delete"],
        apply: (context, database, input) =>
          applyItemMutation(context, database, input, host),
      }],
    },
  });
}
