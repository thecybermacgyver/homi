import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { HomiDatabase } from "@homi/db";
import type { HomiRequestContext } from "./context.js";

export interface HomiSyncChange {
  sequence: string;
  householdId: string;
  moduleKey: string;
  entityType: string;
  entityId: string;
  operation: string;
  revision: string;
  changedByUserId: string | null;
  clientId: string | null;
  changedAt: string;
}

export interface HomiSyncChangePage {
  changes: HomiSyncChange[];
  nextSequence: string;
  hasMore: boolean;
}

export interface HomiSyncStatus {
  clientId: string;
  householdId: string;
  lastChangeSequence: string;
  latestChangeSequence: string;
}

export interface HomiHouseholdSyncPayload {
  name?: string;
  defaultLocale?: string;
  timeZone?: string;
}

export interface HomiSyncMutationInput {
  clientMutationId: string;
  moduleKey: "core";
  entityType: "household";
  entityId: string;
  operation: "update";
  baseRevision: bigint;
  payload: HomiHouseholdSyncPayload;
}

export interface HomiSyncMutationServerState {
  id: string;
  name: string;
  defaultLocale: string;
  timeZone: string;
  revision: string;
}

export interface HomiSyncMutationResult {
  clientMutationId: string;
  status: "received" | "applied" | "conflict" | "rejected";
  serverRevision: string | null;
  changeSequence: string | null;
  errorCode: string | null;
  serverState: HomiSyncMutationServerState | null;
  replayed: boolean;
}

export interface HomiSyncService {
  getChanges(
    context: HomiRequestContext,
    afterSequence: bigint,
    limit: number,
  ): Promise<HomiSyncChangePage>;

  getStatus(
    context: HomiRequestContext,
  ): Promise<HomiSyncStatus>;

  acknowledgeCursor(
    context: HomiRequestContext,
    lastChangeSequence: bigint,
  ): Promise<HomiSyncStatus>;

  applyMutation(
    context: HomiRequestContext,
    input: HomiSyncMutationInput,
  ): Promise<HomiSyncMutationResult>;
}

interface ChangeRow {
  sequence: string;
  householdId: string;
  moduleKey: string;
  entityType: string;
  entityId: string;
  operation: string;
  revision: string;
  changedByUserId: string | null;
  clientId: string | null;
  changedAt: Date | string;
}

interface SyncStatusRow {
  lastChangeSequence: string;
  latestChangeSequence: string;
}

interface MutationRow {
  clientMutationId: string;
  status: HomiSyncMutationResult["status"];
  serverRevision: string | null;
  changeSequence: string | null;
  errorCode: string | null;
  requestHash: string | null;
  resultPayload: HomiSyncMutationServerState | null;
}

interface HouseholdRow {
  id: string;
  name: string;
  defaultLocale: string;
  timeZone: string;
  revision: string;
}

export class HomiSyncError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HomiSyncError";
  }
}

function requireClientId(context: HomiRequestContext): string {
  if (!context.clientId) {
    throw new HomiSyncError(
      400,
      "CLIENT_REQUIRED",
      "X-Homi-Client-ID is required for synchronization.",
    );
  }

  return context.clientId;
}

function mutationResult(
  row: MutationRow,
  replayed: boolean,
): HomiSyncMutationResult {
  return {
    clientMutationId: row.clientMutationId,
    status: row.status,
    serverRevision: row.serverRevision,
    changeSequence: row.changeSequence,
    errorCode: row.errorCode,
    serverState: row.resultPayload,
    replayed,
  };
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

function mutationRequestHash(
  context: HomiRequestContext,
  input: HomiSyncMutationInput,
): string {
  const canonicalRequest = canonicalize({
    householdId: context.householdId,
    moduleKey: input.moduleKey,
    entityType: input.entityType,
    entityId: input.entityId,
    operation: input.operation,
    baseRevision: input.baseRevision.toString(),
    payload: input.payload,
  });

  return createHash("sha256")
    .update(JSON.stringify(canonicalRequest))
    .digest("hex");
}

export function createHomiSyncService(
  database: HomiDatabase["db"],
): HomiSyncService {
  async function getStatus(
    context: HomiRequestContext,
  ): Promise<HomiSyncStatus> {
    const clientId = requireClientId(context);

    const result = await database.execute(sql`
      SELECT
        COALESCE(sc.last_change_sequence, 0)::text AS "lastChangeSequence",
        COALESCE(
          (
            SELECT MAX(cl.sequence)
            FROM core.change_log AS cl
            WHERE cl.household_id =
              CAST(${context.householdId} AS uuid)
              AND (
                cl.recipient_user_id IS NULL OR
                cl.recipient_user_id = CAST(${context.userId} AS uuid)
              )
          ),
          0
        )::text AS "latestChangeSequence"
      FROM (SELECT 1) AS anchor
      LEFT JOIN core.sync_cursors AS sc
        ON sc.client_id = CAST(${clientId} AS uuid)
       AND sc.household_id =
         CAST(${context.householdId} AS uuid)
    `);

    const row = result.rows[0] as SyncStatusRow | undefined;

    if (!row) {
      throw new HomiSyncError(
        500,
        "SYNC_STATUS_FAILED",
        "The synchronization status could not be read.",
      );
    }

    return {
      clientId,
      householdId: context.householdId,
      lastChangeSequence: row.lastChangeSequence,
      latestChangeSequence: row.latestChangeSequence,
    };
  }

  return {
    async getChanges(context, afterSequence, limit) {
      requireClientId(context);

      const result = await database.execute(sql`
        SELECT
          sequence,
          household_id AS "householdId",
          module_key AS "moduleKey",
          entity_type AS "entityType",
          entity_id AS "entityId",
          operation,
          revision,
          changed_by_user_id AS "changedByUserId",
          client_id AS "clientId",
          changed_at AS "changedAt"
        FROM core.change_log
        WHERE household_id = CAST(${context.householdId} AS uuid)
          AND (
            recipient_user_id IS NULL OR
            recipient_user_id = CAST(${context.userId} AS uuid)
          )
          AND sequence > CAST(${afterSequence.toString()} AS bigint)
        ORDER BY sequence ASC
        LIMIT ${limit + 1}
      `);

      const rows = result.rows as unknown as ChangeRow[];
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;

      const changes = pageRows.map((row) => ({
        sequence: String(row.sequence),
        householdId: row.householdId,
        moduleKey: row.moduleKey,
        entityType: row.entityType,
        entityId: row.entityId,
        operation: row.operation,
        revision: String(row.revision),
        changedByUserId: row.changedByUserId,
        clientId: row.clientId,
        changedAt:
          row.changedAt instanceof Date
            ? row.changedAt.toISOString()
            : new Date(row.changedAt).toISOString(),
      }));

      return {
        changes,
        nextSequence:
          changes.at(-1)?.sequence ?? afterSequence.toString(),
        hasMore,
      };
    },

    getStatus,

    async acknowledgeCursor(context, lastChangeSequence) {
      const clientId = requireClientId(context);

      return database.transaction(async (tx) => {
        const latestResult = await tx.execute(sql`
          SELECT COALESCE(MAX(sequence), 0)::text AS "latestChangeSequence"
          FROM core.change_log
          WHERE household_id =
            CAST(${context.householdId} AS uuid)
            AND (
              recipient_user_id IS NULL OR
              recipient_user_id = CAST(${context.userId} AS uuid)
            )
        `);

        const latestRow = latestResult.rows[0] as
          | { latestChangeSequence: string }
          | undefined;

        if (!latestRow) {
          throw new HomiSyncError(
            500,
            "SYNC_STATUS_FAILED",
            "The synchronization status could not be read.",
          );
        }

        const latestChangeSequence =
          BigInt(latestRow.latestChangeSequence);

        if (lastChangeSequence > latestChangeSequence) {
          throw new HomiSyncError(
            409,
            "CURSOR_AHEAD_OF_SERVER",
            "The acknowledged sync sequence is ahead of the server.",
          );
        }

        const cursorResult = await tx.execute(sql`
          INSERT INTO core.sync_cursors (
            client_id,
            household_id,
            last_change_sequence,
            updated_at
          )
          VALUES (
            CAST(${clientId} AS uuid),
            CAST(${context.householdId} AS uuid),
            CAST(${lastChangeSequence.toString()} AS bigint),
            now()
          )
          ON CONFLICT (client_id, household_id)
          DO UPDATE SET
            last_change_sequence = GREATEST(
              core.sync_cursors.last_change_sequence,
              EXCLUDED.last_change_sequence
            ),
            updated_at = CASE
              WHEN EXCLUDED.last_change_sequence >
                core.sync_cursors.last_change_sequence
              THEN now()
              ELSE core.sync_cursors.updated_at
            END
          RETURNING last_change_sequence::text AS "lastChangeSequence"
        `);

        const cursorRow = cursorResult.rows[0] as
          | { lastChangeSequence: string }
          | undefined;

        if (!cursorRow) {
          throw new HomiSyncError(
            500,
            "SYNC_CURSOR_FAILED",
            "The synchronization cursor could not be saved.",
          );
        }

        return {
          clientId,
          householdId: context.householdId,
          lastChangeSequence: cursorRow.lastChangeSequence,
          latestChangeSequence:
            latestChangeSequence.toString(),
        };
      });
    },

    async applyMutation(context, input) {
      const clientId = requireClientId(context);

      if (input.entityId !== context.householdId) {
        throw new HomiSyncError(
          403,
          "MUTATION_TARGET_DENIED",
          "The mutation target does not match the active household.",
        );
      }

      const requestHash = mutationRequestHash(context, input);

      return database.transaction(async (tx) => {
        const receiptResult = await tx.execute(sql`
          INSERT INTO core.sync_mutations (
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
            CAST(${clientId} AS uuid),
            CAST(${context.householdId} AS uuid),
            CAST(${input.clientMutationId} AS uuid),
            ${input.moduleKey},
            ${input.entityType},
            CAST(${input.entityId} AS uuid),
            CAST(${input.baseRevision.toString()} AS bigint),
            ${requestHash},
            'received'
          )
          ON CONFLICT (client_id, client_mutation_id)
          DO NOTHING
          RETURNING
            client_mutation_id AS "clientMutationId",
            status,
            server_revision::text AS "serverRevision",
            change_sequence::text AS "changeSequence",
            error_code AS "errorCode",
            request_hash AS "requestHash",
            result_payload AS "resultPayload"
        `);

        if (receiptResult.rows.length === 0) {
          const replayResult = await tx.execute(sql`
            SELECT
              client_mutation_id AS "clientMutationId",
              status,
              server_revision::text AS "serverRevision",
              change_sequence::text AS "changeSequence",
              error_code AS "errorCode",
              request_hash AS "requestHash",
              result_payload AS "resultPayload"
            FROM core.sync_mutations
            WHERE client_id = CAST(${clientId} AS uuid)
              AND client_mutation_id =
                CAST(${input.clientMutationId} AS uuid)
            LIMIT 1
          `);

          const replay =
            replayResult.rows[0] as MutationRow | undefined;

          if (!replay) {
            throw new HomiSyncError(
              500,
              "MUTATION_REPLAY_FAILED",
              "The prior mutation result could not be read.",
            );
          }

          if (!replay.requestHash) {
            throw new HomiSyncError(
              409,
              "MUTATION_ID_UNVERIFIABLE",
              "This legacy mutation ID cannot be safely replayed.",
            );
          }

          if (replay.requestHash !== requestHash) {
            throw new HomiSyncError(
              409,
              "MUTATION_ID_REUSED",
              "clientMutationId was already used for a different mutation.",
            );
          }

          return mutationResult(replay, true);
        }

        const currentResult = await tx.execute(sql`
          SELECT
            id,
            name,
            default_locale AS "defaultLocale",
            time_zone AS "timeZone",
            revision::text AS revision
          FROM core.households
          WHERE id = CAST(${context.householdId} AS uuid)
            AND status = 'active'
            AND deleted_at IS NULL
          FOR UPDATE
        `);

        const current =
          currentResult.rows[0] as HouseholdRow | undefined;

        if (!current) {
          const rejectedResult = await tx.execute(sql`
            UPDATE core.sync_mutations
            SET
              status = 'rejected',
              error_code = 'HOUSEHOLD_NOT_FOUND'
            WHERE client_id = CAST(${clientId} AS uuid)
              AND client_mutation_id =
                CAST(${input.clientMutationId} AS uuid)
            RETURNING
              client_mutation_id AS "clientMutationId",
              status,
              server_revision::text AS "serverRevision",
              change_sequence::text AS "changeSequence",
              error_code AS "errorCode",
              request_hash AS "requestHash",
              result_payload AS "resultPayload"
          `);

          const rejected =
            rejectedResult.rows[0] as MutationRow | undefined;

          if (!rejected) {
            throw new HomiSyncError(
              500,
              "MUTATION_RESULT_FAILED",
              "The mutation result could not be saved.",
            );
          }

          return mutationResult(rejected, false);
        }

        const currentRevision = BigInt(current.revision);

        if (currentRevision !== input.baseRevision) {
          const conflictResult = await tx.execute(sql`
            UPDATE core.sync_mutations
            SET
              status = 'conflict',
              server_revision =
                CAST(${current.revision} AS bigint),
              error_code = 'REVISION_CONFLICT',
              result_payload = jsonb_build_object(
                'id', CAST(${current.id} AS text),
                'name', CAST(${current.name} AS text),
                'defaultLocale', CAST(${current.defaultLocale} AS text),
                'timeZone', CAST(${current.timeZone} AS text),
                'revision', CAST(${current.revision} AS text)
              )
            WHERE client_id = CAST(${clientId} AS uuid)
              AND client_mutation_id =
                CAST(${input.clientMutationId} AS uuid)
            RETURNING
              client_mutation_id AS "clientMutationId",
              status,
              server_revision::text AS "serverRevision",
              change_sequence::text AS "changeSequence",
              error_code AS "errorCode",
              request_hash AS "requestHash",
              result_payload AS "resultPayload"
          `);

          const conflict =
            conflictResult.rows[0] as MutationRow | undefined;

          if (!conflict) {
            throw new HomiSyncError(
              500,
              "MUTATION_RESULT_FAILED",
              "The mutation conflict could not be saved.",
            );
          }

          return mutationResult(conflict, false);
        }

        const nextName = input.payload.name ?? current.name;
        const nextLocale =
          input.payload.defaultLocale ?? current.defaultLocale;
        const nextTimeZone =
          input.payload.timeZone ?? current.timeZone;

        const updateResult = await tx.execute(sql`
          UPDATE core.households
          SET
            name = ${nextName},
            default_locale = ${nextLocale},
            time_zone = ${nextTimeZone},
            revision = revision + 1,
            updated_at = now()
          WHERE id = CAST(${context.householdId} AS uuid)
          RETURNING revision::text AS revision
        `);

        const updated = updateResult.rows[0] as
          | { revision: string }
          | undefined;

        if (!updated) {
          throw new HomiSyncError(
            500,
            "MUTATION_APPLY_FAILED",
            "The household mutation could not be applied.",
          );
        }

        const auditMetadata = JSON.stringify({
          source: "sync",
          clientMutationId: input.clientMutationId,
          before: {
            name: current.name,
            defaultLocale: current.defaultLocale,
            timeZone: current.timeZone,
            revision: current.revision,
          },
          after: {
            name: nextName,
            defaultLocale: nextLocale,
            timeZone: nextTimeZone,
            revision: updated.revision,
          },
        });

        await tx.execute(sql`
          INSERT INTO core.audit_log (
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
            CAST(${context.householdId} AS uuid),
            CAST(${context.userId} AS uuid),
            CAST(${clientId} AS uuid),
            'core.household.settings.updated',
            'household',
            CAST(${context.householdId} AS uuid),
            'core',
            ${context.requestId},
            CAST(${auditMetadata} AS jsonb)
          )
        `);

        const changeResult = await tx.execute(sql`
          INSERT INTO core.change_log (
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
            CAST(${context.householdId} AS uuid),
            'core',
            'household',
            CAST(${context.householdId} AS uuid),
            'update',
            CAST(${updated.revision} AS bigint),
            CAST(${context.userId} AS uuid),
            CAST(${clientId} AS uuid)
          )
          RETURNING sequence::text AS sequence
        `);

        const change = changeResult.rows[0] as
          | { sequence: string }
          | undefined;

        if (!change) {
          throw new HomiSyncError(
            500,
            "CHANGE_LOG_FAILED",
            "The mutation change could not be recorded.",
          );
        }

        const appliedResult = await tx.execute(sql`
          UPDATE core.sync_mutations
          SET
            status = 'applied',
            server_revision =
              CAST(${updated.revision} AS bigint),
            change_sequence =
              CAST(${change.sequence} AS bigint),
            applied_at = now(),
            error_code = NULL,
            result_payload = jsonb_build_object(
              'id', CAST(${current.id} AS text),
              'name', CAST(${nextName} AS text),
              'defaultLocale', CAST(${nextLocale} AS text),
              'timeZone', CAST(${nextTimeZone} AS text),
              'revision', CAST(${updated.revision} AS text)
            )
          WHERE client_id = CAST(${clientId} AS uuid)
            AND client_mutation_id =
              CAST(${input.clientMutationId} AS uuid)
          RETURNING
            client_mutation_id AS "clientMutationId",
            status,
            server_revision::text AS "serverRevision",
            change_sequence::text AS "changeSequence",
            error_code AS "errorCode",
            request_hash AS "requestHash",
            result_payload AS "resultPayload"
        `);

        const applied =
          appliedResult.rows[0] as MutationRow | undefined;

        if (!applied) {
          throw new HomiSyncError(
            500,
            "MUTATION_RESULT_FAILED",
            "The mutation result could not be saved.",
          );
        }

        return mutationResult(applied, false);
      });
    },
  };
}
