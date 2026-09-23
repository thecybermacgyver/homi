import { createHash } from "node:crypto";
import type { HomiDatabase } from "@homi/db";
import type {
  HomiModuleServerMutationHandler,
  HomiRequestContext,
} from "@homi/module-sdk";
import type { HomiRuntimeModule } from "./module-host.js";
import {
  createTransactionalHomiModuleDatabase,
  getHomiModuleSqlPool,
  type HomiModuleSqlClient,
} from "./module-database.js";

export type HomiModuleSyncOperation =
  | "create"
  | "update"
  | "delete";

export interface HomiModuleSyncMutationInput {
  readonly clientMutationId: string;
  readonly moduleKey: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: HomiModuleSyncOperation;
  readonly baseRevision: bigint;
  readonly payload: Record<string, unknown>;
}

export interface HomiModuleSyncMutationResult {
  readonly clientMutationId: string;
  readonly status:
    | "received"
    | "applied"
    | "conflict"
    | "rejected";
  readonly serverRevision: string | null;
  readonly changeSequence: string | null;
  readonly errorCode: string | null;
  readonly serverState: unknown;
  readonly replayed: boolean;
}

export interface HomiModuleSyncService {
  applyMutation(
    context: HomiRequestContext,
    input: HomiModuleSyncMutationInput,
  ): Promise<HomiModuleSyncMutationResult>;
}

export class HomiModuleSyncError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HomiModuleSyncError";
  }
}

interface MutationRow {
  clientMutationId: string;
  status: HomiModuleSyncMutationResult["status"];
  serverRevision: string | null;
  changeSequence: string | null;
  errorCode: string | null;
  requestHash: string | null;
  resultPayload: unknown;
}

interface HandlerOwner {
  readonly moduleKey: string;
  readonly handler: HomiModuleServerMutationHandler;
  readonly createMutationServices?: HomiRuntimeModule["createMutationServices"];
}

function requireClientId(
  context: HomiRequestContext,
): string {
  if (!context.clientId) {
    throw new HomiModuleSyncError(
      400,
      "CLIENT_REQUIRED",
      "X-Homi-Client-ID is required for synchronization.",
    );
  }
  return context.clientId;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (
    typeof value === "object" &&
    value !== null
  ) {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      output[key] = canonicalize(input[key]);
    }
    return output;
  }
  return value;
}

function requestHash(
  context: HomiRequestContext,
  input: HomiModuleSyncMutationInput,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonicalize({
          householdId: context.householdId,
          moduleKey: input.moduleKey,
          entityType: input.entityType,
          entityId: input.entityId,
          operation: input.operation,
          baseRevision: input.baseRevision.toString(),
          payload: input.payload,
        }),
      ),
    )
    .digest("hex");
}

function mutationResult(
  row: MutationRow,
  replayed: boolean,
): HomiModuleSyncMutationResult {
  return Object.freeze({
    clientMutationId: row.clientMutationId,
    status: row.status,
    serverRevision: row.serverRevision,
    changeSequence: row.changeSequence,
    errorCode: row.errorCode,
    serverState: row.resultPayload,
    replayed,
  });
}

function positiveRevision(
  value: string,
  field: string,
): string {
  if (
    !/^[1-9][0-9]*$/.test(value) ||
    BigInt(value) > 9223372036854775807n
  ) {
    throw new HomiModuleSyncError(
      500,
      "MODULE_MUTATION_RESULT_INVALID",
      `${field} must be a positive BIGINT decimal string.`,
    );
  }
  return value;
}

function jsonPayload(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new HomiModuleSyncError(
      500,
      "MODULE_MUTATION_RESULT_INVALID",
      "Module mutation serverState must be JSON-serializable.",
    );
  }
  return serialized;
}

function handlerRegistry(
  modules: readonly HomiRuntimeModule[],
): ReadonlyMap<string, HandlerOwner> {
  const handlers = new Map<string, HandlerOwner>();

  for (const module of modules) {
    for (const handler of module.mutationHandlers ?? []) {
      for (const operation of handler.operations) {
        const key = JSON.stringify([
          module.moduleKey,
          handler.entityType,
          operation,
        ]);
        if (handlers.has(key)) {
          throw new Error(
            `Duplicate module mutation handler ownership for ${module.moduleKey}/${handler.entityType}/${operation}.`,
          );
        }
        handlers.set(key, {
          moduleKey: module.moduleKey,
          handler,
          ...(module.createMutationServices === undefined
            ? {}
            : { createMutationServices: module.createMutationServices }),
        });
      }
    }
  }

  return handlers;
}

function findHandler(
  registry: ReadonlyMap<string, HandlerOwner>,
  input: HomiModuleSyncMutationInput,
): HandlerOwner | null {
  return (
    registry.get(
      JSON.stringify([
        input.moduleKey,
        input.entityType,
        input.operation,
      ]),
    ) ?? null
  );
}

async function readMutation(
  client: HomiModuleSqlClient,
  clientId: string,
  clientMutationId: string,
): Promise<MutationRow | null> {
  const result = await client.query(
    `SELECT
       client_mutation_id AS "clientMutationId",
       status,
       server_revision::text AS "serverRevision",
       change_sequence::text AS "changeSequence",
       error_code AS "errorCode",
       request_hash AS "requestHash",
       result_payload AS "resultPayload"
     FROM core.sync_mutations
     WHERE client_id = $1::uuid
       AND client_mutation_id = $2::uuid
     LIMIT 1`,
    [clientId, clientMutationId],
  );

  return (
    (result.rows[0] as unknown as MutationRow | undefined) ??
    null
  );
}

async function saveRejected(
  client: HomiModuleSqlClient,
  clientId: string,
  input: HomiModuleSyncMutationInput,
  errorCode: string,
  serverRevision: string | null = null,
  serverState: unknown = null,
): Promise<MutationRow> {
  const payload = jsonPayload(serverState);
  const result = await client.query(
    `UPDATE core.sync_mutations
     SET
       status = 'rejected',
       server_revision = $3::bigint,
       error_code = $4,
       result_payload = $5::jsonb
     WHERE client_id = $1::uuid
       AND client_mutation_id = $2::uuid
     RETURNING
       client_mutation_id AS "clientMutationId",
       status,
       server_revision::text AS "serverRevision",
       change_sequence::text AS "changeSequence",
       error_code AS "errorCode",
       request_hash AS "requestHash",
       result_payload AS "resultPayload"`,
    [
      clientId,
      input.clientMutationId,
      serverRevision,
      errorCode,
      payload,
    ],
  );

  const row = result.rows[0] as unknown as
    | MutationRow
    | undefined;
  if (!row) {
    throw new HomiModuleSyncError(
      500,
      "MUTATION_RESULT_FAILED",
      "The module mutation rejection could not be saved.",
    );
  }
  return row;
}

export function createHomiModuleSyncService(
  database: HomiDatabase["db"],
  modules: readonly HomiRuntimeModule[],
): HomiModuleSyncService {
  const registry = handlerRegistry(modules);
  const pool = getHomiModuleSqlPool(database);

  return Object.freeze({
    async applyMutation(
      context: HomiRequestContext,
      input: HomiModuleSyncMutationInput,
    ) {
      const clientId = requireClientId(context);
      const hash = requestHash(context, input);
      const owner = findHandler(registry, input);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const receiptResult = await client.query(
          `INSERT INTO core.sync_mutations (
             client_id,
             household_id,
             client_mutation_id,
             module_key,
             entity_type,
             entity_id,
             base_revision,
             request_hash,
             status
           )
           VALUES (
             $1::uuid,
             $2::uuid,
             $3::uuid,
             $4,
             $5,
             $6::uuid,
             $7::bigint,
             $8,
             'received'
           )
           ON CONFLICT (client_id, client_mutation_id)
           DO NOTHING
           RETURNING client_mutation_id`,
          [
            clientId,
            context.householdId,
            input.clientMutationId,
            input.moduleKey,
            input.entityType,
            input.entityId,
            input.baseRevision.toString(),
            hash,
          ],
        );

        if (receiptResult.rows.length === 0) {
          const replay = await readMutation(
            client,
            clientId,
            input.clientMutationId,
          );

          if (!replay) {
            throw new HomiModuleSyncError(
              500,
              "MUTATION_REPLAY_FAILED",
              "The prior module mutation result could not be read.",
            );
          }
          if (!replay.requestHash) {
            throw new HomiModuleSyncError(
              409,
              "MUTATION_ID_UNVERIFIABLE",
              "This legacy mutation ID cannot be safely replayed.",
            );
          }
          if (replay.requestHash !== hash) {
            throw new HomiModuleSyncError(
              409,
              "MUTATION_ID_REUSED",
              "clientMutationId was already used for a different mutation.",
            );
          }

          await client.query("COMMIT");
          return mutationResult(replay, true);
        }

        if (!owner) {
          const rejected = await saveRejected(
            client,
            clientId,
            input,
            "MODULE_MUTATION_HANDLER_UNAVAILABLE",
          );
          await client.query("COMMIT");
          return mutationResult(rejected, false);
        }

        const enabledResult = await client.query(
          `SELECT 1
           FROM core.modules AS m
           JOIN core.household_modules AS hm
             ON hm.module_id = m.id
           WHERE m.module_key = $1
             AND m.state = 'installed'
             AND hm.household_id = $2::uuid
             AND hm.enabled = true
           LIMIT 1`,
          [input.moduleKey, context.householdId],
        );

        if (enabledResult.rows.length === 0) {
          const rejected = await saveRejected(
            client,
            clientId,
            input,
            "MODULE_NOT_ENABLED",
          );
          await client.query("COMMIT");
          return mutationResult(rejected, false);
        }

        const mutationServices = owner.createMutationServices
          ? await owner.createMutationServices(client, context)
          : Object.freeze({});
        const result = await owner.handler.apply(
          context,
          createTransactionalHomiModuleDatabase(client),
          {
            entityId: input.entityId,
            operation: input.operation,
            baseRevision: input.baseRevision.toString(),
            payload: input.payload,
          },
          mutationServices,
        );

        if (result.status === "conflict") {
          const revision = positiveRevision(
            result.revision,
            "Module conflict revision",
          );
          const payload = jsonPayload(result.serverState);
          const stored = await client.query(
            `UPDATE core.sync_mutations
             SET
               status = 'conflict',
               server_revision = $3::bigint,
               error_code = $4,
               result_payload = $5::jsonb
             WHERE client_id = $1::uuid
               AND client_mutation_id = $2::uuid
             RETURNING
               client_mutation_id AS "clientMutationId",
               status,
               server_revision::text AS "serverRevision",
               change_sequence::text AS "changeSequence",
               error_code AS "errorCode",
               request_hash AS "requestHash",
               result_payload AS "resultPayload"`,
            [
              clientId,
              input.clientMutationId,
              revision,
              result.errorCode ?? "REVISION_CONFLICT",
              payload,
            ],
          );
          const row = stored.rows[0] as unknown as
            | MutationRow
            | undefined;
          if (!row) {
            throw new HomiModuleSyncError(
              500,
              "MUTATION_RESULT_FAILED",
              "The module mutation conflict could not be saved.",
            );
          }
          await client.query("COMMIT");
          return mutationResult(row, false);
        }

        if (result.status === "rejected") {
          const revision =
            result.revision === null
              ? null
              : positiveRevision(
                  result.revision,
                  "Module rejection revision",
                );
          const rejected = await saveRejected(
            client,
            clientId,
            input,
            result.errorCode,
            revision,
            result.serverState,
          );
          await client.query("COMMIT");
          return mutationResult(rejected, false);
        }

        const revision = positiveRevision(
          result.revision,
          "Module applied revision",
        );
        const statePayload = jsonPayload(result.serverState);

        await client.query(
          `INSERT INTO core.audit_log (
             household_id,
             actor_user_id,
             actor_client_id,
             action,
             target_type,
             target_id,
             source_module_key,
             request_id,
             metadata
           )
           VALUES (
             $1::uuid,
             $2::uuid,
             $3::uuid,
             $4,
             $5,
             $6::uuid,
             $7,
             $8,
             $9::jsonb
           )`,
          [
            context.householdId,
            context.userId,
            clientId,
            `${input.moduleKey}.${input.entityType}.${input.operation}`,
            input.entityType,
            input.entityId,
            input.moduleKey,
            context.requestId,
            JSON.stringify({
              source: "sync",
              clientMutationId: input.clientMutationId,
              baseRevision: input.baseRevision.toString(),
              revision,
            }),
          ],
        );

        const changeResult = await client.query(
          `INSERT INTO core.change_log (
             household_id,
             module_key,
             entity_type,
             entity_id,
             operation,
             revision,
             changed_by_user_id,
             client_id
           )
           VALUES (
             $1::uuid,
             $2,
             $3,
             $4::uuid,
             $5,
             $6::bigint,
             $7::uuid,
             $8::uuid
           )
           RETURNING sequence::text AS sequence`,
          [
            context.householdId,
            input.moduleKey,
            input.entityType,
            input.entityId,
            input.operation,
            revision,
            context.userId,
            clientId,
          ],
        );

        const change = changeResult.rows[0] as unknown as
          | { sequence: string }
          | undefined;
        if (!change) {
          throw new HomiModuleSyncError(
            500,
            "CHANGE_LOG_FAILED",
            "The module mutation change could not be recorded.",
          );
        }

        await client.query(
          `INSERT INTO core.event_outbox (
             household_id,
             source_module_key,
             event_type,
             aggregate_type,
             aggregate_id,
             payload
           )
           VALUES (
             $1::uuid,
             $2,
             $3,
             $4,
             $5::uuid,
             $6::jsonb
           )`,
          [
            context.householdId,
            input.moduleKey,
            `${input.moduleKey}.${input.entityType}.${input.operation}`,
            input.entityType,
            input.entityId,
            JSON.stringify({
              clientMutationId: input.clientMutationId,
              revision,
              serverState: result.serverState,
            }),
          ],
        );

        const appliedResult = await client.query(
          `UPDATE core.sync_mutations
           SET
             status = 'applied',
             server_revision = $3::bigint,
             change_sequence = $4::bigint,
             applied_at = now(),
             error_code = NULL,
             result_payload = $5::jsonb
           WHERE client_id = $1::uuid
             AND client_mutation_id = $2::uuid
           RETURNING
             client_mutation_id AS "clientMutationId",
             status,
             server_revision::text AS "serverRevision",
             change_sequence::text AS "changeSequence",
             error_code AS "errorCode",
             request_hash AS "requestHash",
             result_payload AS "resultPayload"`,
          [
            clientId,
            input.clientMutationId,
            revision,
            change.sequence,
            statePayload,
          ],
        );

        const applied = appliedResult.rows[0] as unknown as
          | MutationRow
          | undefined;
        if (!applied) {
          throw new HomiModuleSyncError(
            500,
            "MUTATION_RESULT_FAILED",
            "The module mutation result could not be saved.",
          );
        }

        await client.query("COMMIT");
        return mutationResult(applied, false);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  });
}
