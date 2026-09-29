import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { HomiDatabase } from "@homi/db";
import {
  isHomiFamilyBoardPlacement,
  resolveHomiFamilyBoardCardLimits,
  type HomiFamilyBoardLayout,
  type HomiFamilyBoardPlacement,
  type HomiModuleFamilyBoardSizeManifest,
  type HomiRequestContext,
} from "@homi/module-sdk";

export interface HomiMemberModulePreference {
  readonly id: string;
  readonly moduleId: string;
  readonly moduleKey: string;
  readonly surfaceId: string;
  readonly label: string;
  readonly visible: boolean;
  readonly displayOrder: number;
  readonly cardStyle: string | null;
  readonly cardStyles: readonly HomiMemberCardStyle[];
  readonly phoneLayout: HomiFamilyBoardPlacement | null;
  readonly wideLayout: HomiFamilyBoardPlacement | null;
  readonly revision: bigint;
}

export interface HomiMemberCardStyle {
  readonly id: string;
  readonly label: string;
}

export interface HomiMemberModulePreferencePayload {
  readonly visible?: boolean;
  readonly displayOrder?: number;
  readonly cardStyle?: string;
  // null clears the saved placement so Homi packs the card again.
  readonly phoneLayout?: HomiFamilyBoardPlacement | null;
  readonly wideLayout?: HomiFamilyBoardPlacement | null;
}

export interface HomiMemberModulePreferenceMutationInput {
  readonly clientMutationId: string;
  readonly entityId: string;
  readonly baseRevision: bigint;
  readonly payload: HomiMemberModulePreferencePayload;
}
export interface HomiMemberModulePreferenceMutationServerState {
  readonly id: string;
  readonly moduleId: string;
  readonly moduleKey: string;
  readonly surfaceId: string;
  readonly label: string;
  readonly visible: boolean;
  readonly displayOrder: number;
  readonly cardStyle: string | null;
  readonly cardStyles: readonly HomiMemberCardStyle[];
  readonly phoneLayout: HomiFamilyBoardPlacement | null;
  readonly wideLayout: HomiFamilyBoardPlacement | null;
  readonly revision: string;
}

export interface HomiMemberModulePreferenceMutationResult {
  readonly clientMutationId: string;
  readonly status: "received" | "applied" | "conflict" | "rejected";
  readonly serverRevision: string | null;
  readonly changeSequence: string | null;
  readonly errorCode: string | null;
  readonly serverState: HomiMemberModulePreferenceMutationServerState | null;
  readonly replayed: boolean;
}

export interface HomiMemberModulePreferenceService {
  list(
    context: HomiRequestContext,
  ): Promise<readonly HomiMemberModulePreference[]>;

  applyMutation(
    context: HomiRequestContext,
    input: HomiMemberModulePreferenceMutationInput,
  ): Promise<HomiMemberModulePreferenceMutationResult>;
}

export class HomiMemberModulePreferenceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HomiMemberModulePreferenceError";
  }
}

interface CatalogRow {
  moduleId: string;
  moduleKey: string;
  surfaceId: string;
  label: string;
  preferenceId: string | null;
  visible: boolean | null;
  displayOrder: number | null;
  cardStyle: string | null;
  styles: unknown;
  phoneLayout: unknown;
  wideLayout: unknown;
  revision: string | null;
}

interface StoredPreferenceRow {
  id: string;
  moduleId: string;
  moduleKey: string;
  surfaceId: string;
  label: string;
  visible: boolean;
  displayOrder: number;
  cardStyle: string | null;
  styles: unknown;
  size?: unknown;
  phoneLayout: unknown;
  wideLayout: unknown;
  revision: string;
}

interface MutationRow {
  clientMutationId: string;
  status: HomiMemberModulePreferenceMutationResult["status"];
  serverRevision: string | null;
  changeSequence: string | null;
  errorCode: string | null;
  requestHash: string | null;
  resultPayload: HomiMemberModulePreferenceMutationServerState | null;
}

function requireClientId(context: HomiRequestContext): string {
  if (!context.clientId) {
    throw new HomiMemberModulePreferenceError(
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
  if (typeof value === "object" && value !== null) {
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
  input: HomiMemberModulePreferenceMutationInput,
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize({
      householdId: context.householdId,
      moduleKey: "core",
      entityType: "member-module-preference",
      entityId: input.entityId,
      operation: "update",
      baseRevision: input.baseRevision.toString(),
      payload: input.payload,
    })))
    .digest("hex");
}
// Styles come from the installed manifest, which the SDK validated on install.
function cardStyles(value: unknown): readonly HomiMemberCardStyle[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.flatMap((style: unknown) => {
    if (typeof style !== "object" || style === null) return [];
    const { id, label } = style as Record<string, unknown>;
    return typeof id === "string" && typeof label === "string"
      ? [Object.freeze({ id, label })]
      : [];
  }));
}

// A stored style the current module version no longer offers falls back to
// the default, so a module update never leaves a card without a style.
function effectiveCardStyle(
  stored: string | null,
  styles: readonly HomiMemberCardStyle[],
): string | null {
  if (styles.length === 0) return null;
  return styles.some((style) => style.id === stored)
    ? stored
    : styles[0]!.id;
}

// A placement that no longer fits the board is dropped so Homi packs the card.
function placement(
  value: unknown,
  layout: HomiFamilyBoardLayout,
): HomiFamilyBoardPlacement | null {
  return isHomiFamilyBoardPlacement(value, layout)
    ? Object.freeze({ x: value.x, y: value.y, w: value.w, h: value.h })
    : null;
}

// Sizes come from the installed manifest, which the SDK validated on install.
function declaredSize(
  value: unknown,
): HomiModuleFamilyBoardSizeManifest | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as HomiModuleFamilyBoardSizeManifest)
    : undefined;
}

function withinCardLimits(
  value: HomiFamilyBoardPlacement,
  size: unknown,
  layout: HomiFamilyBoardLayout,
): boolean {
  const limits = resolveHomiFamilyBoardCardLimits(declaredSize(size), layout);
  return (
    value.w >= limits.min.w &&
    value.w <= limits.max.w &&
    value.h >= limits.min.h &&
    value.h <= limits.max.h
  );
}

function snapshot(
  row: StoredPreferenceRow,
): HomiMemberModulePreference {
  const styles = cardStyles(row.styles);
  return Object.freeze({
    id: row.id,
    moduleId: row.moduleId,
    moduleKey: row.moduleKey,
    surfaceId: row.surfaceId,
    label: row.label,
    visible: row.visible,
    displayOrder: row.displayOrder,
    cardStyle: effectiveCardStyle(row.cardStyle, styles),
    cardStyles: styles,
    phoneLayout: placement(row.phoneLayout, "phone"),
    wideLayout: placement(row.wideLayout, "wide"),
    revision: BigInt(row.revision),
  });
}

function mutationResult(
  row: MutationRow,
  replayed: boolean,
): HomiMemberModulePreferenceMutationResult {
  const state = row.resultPayload;
  return Object.freeze({
    clientMutationId: row.clientMutationId,
    status: row.status,
    serverRevision: row.serverRevision,
    changeSequence: row.changeSequence,
    errorCode: row.errorCode,
    serverState:
      state === null
        ? null
        : Object.freeze({
            id: state.id,
            moduleId: state.moduleId,
            moduleKey: state.moduleKey,
            surfaceId: state.surfaceId,
            label: state.label,
            visible: state.visible,
            displayOrder: state.displayOrder,
            // Receipts stored before card styles existed lack these fields.
            cardStyle: state.cardStyle ?? null,
            cardStyles: state.cardStyles ?? [],
            // Receipts stored before card layouts existed lack these fields.
            phoneLayout: state.phoneLayout ?? null,
            wideLayout: state.wideLayout ?? null,
            revision: state.revision,
          }),
    replayed,
  });
}
async function catalogRows(
  executor: Pick<HomiDatabase["db"], "execute">,
  context: HomiRequestContext,
): Promise<CatalogRow[]> {
  const result = await executor.execute(sql`
    SELECT
      m.id AS "moduleId",
      m.module_key AS "moduleKey",
      contribution.value ->> 'surfaceId' AS "surfaceId",
      COALESCE(
        contribution.value ->> 'label',
        contribution.value ->> 'surfaceId'
      ) AS label,
      p.id AS "preferenceId",
      p.visible,
      p.display_order AS "displayOrder",
      p.card_style AS "cardStyle",
      contribution.value -> 'styles' AS styles,
      p.phone_layout AS "phoneLayout",
      p.wide_layout AS "wideLayout",
      p.revision::text AS revision
    FROM core.household_modules AS hm
    JOIN core.modules AS m
      ON m.id = hm.module_id
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(m.manifest -> 'extensions' -> 'familyBoard', '[]'::jsonb)
    ) WITH ORDINALITY AS contribution(value, ordinal)
    LEFT JOIN core.household_member_module_preferences AS p
      ON p.household_id = hm.household_id
     AND p.membership_id = CAST(${context.membershipId} AS uuid)
     AND p.module_id = hm.module_id
     AND p.surface_id = contribution.value ->> 'surfaceId'
    WHERE hm.household_id = CAST(${context.householdId} AS uuid)
      AND m.state = 'installed'
    ORDER BY m.name, m.module_key, contribution.ordinal
  `);
  return result.rows as unknown as CatalogRow[];
}
async function ensurePreferences(
  database: HomiDatabase["db"],
  context: HomiRequestContext,
): Promise<readonly HomiMemberModulePreference[]> {
  return database.transaction(async (tx) => {
    const initial = await catalogRows(tx, context);

    let nextOrder =
      initial.reduce(
        (maximum, row) =>
          row.displayOrder === null
            ? maximum
            : Math.max(maximum, row.displayOrder),
        -1,
      ) + 1;

    const inheritedVisibility = new Map<string, boolean>();
    for (const row of initial) {
      if (row.visible !== null) {
        inheritedVisibility.set(row.moduleId, row.visible);
      }
    }

    for (const row of initial) {
      if (row.preferenceId !== null) continue;
      const visible = inheritedVisibility.get(row.moduleId) ?? true;

      await tx.execute(sql`
        INSERT INTO core.household_member_module_preferences (
          household_id,
          membership_id,
          module_id,
          surface_id,
          visible,
          display_order,
          revision
        )
        VALUES (
          CAST(${context.householdId} AS uuid),
          CAST(${context.membershipId} AS uuid),
          CAST(${row.moduleId} AS uuid),
          ${row.surfaceId},
          ${visible},
          ${nextOrder},
          1
        )
        ON CONFLICT (household_id, membership_id, module_id, surface_id)
        DO NOTHING
      `);
      nextOrder += 1;
    }

    const rows = await catalogRows(tx, context);

    return Object.freeze(
      rows.map((row) => {
        if (
          row.preferenceId === null ||
          row.visible === null ||
          row.displayOrder === null ||
          row.revision === null
        ) {
          throw new HomiMemberModulePreferenceError(
            500,
            "MODULE_PREFERENCE_INITIALIZATION_FAILED",
            "The personal module layout could not be initialized.",
          );
        }
        return snapshot({
          id: row.preferenceId,
          moduleId: row.moduleId,
          moduleKey: row.moduleKey,
          surfaceId: row.surfaceId,
          label: row.label,
          visible: row.visible,
          displayOrder: row.displayOrder,
          cardStyle: row.cardStyle,
          styles: row.styles,
          phoneLayout: row.phoneLayout,
          wideLayout: row.wideLayout,
          revision: row.revision,
        });
      }),
    );
  });
}

function validatePayload(
  input: HomiMemberModulePreferenceMutationInput,
): void {
  if (input.baseRevision < 1n) {
    throw new HomiMemberModulePreferenceError(
      400,
      "MODULE_PREFERENCE_REVISION_INVALID",
      "baseRevision must be positive.",
    );
  }
  if (
    input.payload.displayOrder !== undefined &&
    (
      !Number.isSafeInteger(input.payload.displayOrder) ||
      input.payload.displayOrder < 0 ||
      input.payload.displayOrder > 2147483647
    )
  ) {
    throw new HomiMemberModulePreferenceError(
      400,
      "MODULE_PREFERENCE_ORDER_INVALID",
      "displayOrder must be a non-negative 32-bit integer.",
    );
  }
  if (
    input.payload.cardStyle !== undefined &&
    !/^[a-z][a-z0-9-]{0,63}$/.test(input.payload.cardStyle)
  ) {
    throw new HomiMemberModulePreferenceError(
      400,
      "MODULE_PREFERENCE_CARD_STYLE_INVALID",
      "cardStyle must be a card style identifier.",
    );
  }
  for (const layout of ["phone", "wide"] as const) {
    const value = input.payload[`${layout}Layout`];
    if (
      value !== undefined &&
      value !== null &&
      !isHomiFamilyBoardPlacement(value, layout)
    ) {
      throw new HomiMemberModulePreferenceError(
        400,
        "MODULE_PREFERENCE_LAYOUT_INVALID",
        `${layout}Layout must be a card placement on the ${layout} board.`,
      );
    }
  }
  if (
    input.payload.visible === undefined &&
    input.payload.displayOrder === undefined &&
    input.payload.cardStyle === undefined &&
    input.payload.phoneLayout === undefined &&
    input.payload.wideLayout === undefined
  ) {
    throw new HomiMemberModulePreferenceError(
      400,
      "MODULE_PREFERENCE_PAYLOAD_EMPTY",
      "At least one personal module preference must be supplied.",
    );
  }
}

export function createHomiMemberModulePreferenceService(
  database: HomiDatabase["db"],
): HomiMemberModulePreferenceService {
  return Object.freeze({
    list(context: HomiRequestContext) {
      return ensurePreferences(database, context);
    },

    async applyMutation(
      context: HomiRequestContext,
      input: HomiMemberModulePreferenceMutationInput,
    ) {
      validatePayload(input);
      const clientId = requireClientId(context);
      const hash = requestHash(context, input);

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
            'core',
            'member-module-preference',
            CAST(${input.entityId} AS uuid),
            CAST(${input.baseRevision.toString()} AS bigint),
            ${hash},
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
            throw new HomiMemberModulePreferenceError(
              500,
              "MUTATION_REPLAY_FAILED",
              "The prior preference mutation result could not be read.",
            );
          }
          if (!replay.requestHash) {
            throw new HomiMemberModulePreferenceError(
              409,
              "MUTATION_ID_UNVERIFIABLE",
              "This legacy mutation ID cannot be safely replayed.",
            );
          }
          if (replay.requestHash !== hash) {
            throw new HomiMemberModulePreferenceError(
              409,
              "MUTATION_ID_REUSED",
              "clientMutationId was already used for a different mutation.",
            );
          }
          return mutationResult(replay, true);
        }

        const currentResult = await tx.execute(sql`
          SELECT
            p.id,
            p.module_id AS "moduleId",
            m.module_key AS "moduleKey",
            p.surface_id AS "surfaceId",
            COALESCE(
              (
                SELECT contribution.value ->> 'label'
                FROM jsonb_array_elements(
                  COALESCE(
                    m.manifest -> 'extensions' -> 'familyBoard',
                    '[]'::jsonb
                  )
                ) AS contribution(value)
                WHERE contribution.value ->> 'surfaceId' = p.surface_id
                LIMIT 1
              ),
              p.surface_id
            ) AS label,
            p.visible,
            p.display_order AS "displayOrder",
            p.card_style AS "cardStyle",
            (
              SELECT contribution.value -> 'styles'
              FROM jsonb_array_elements(
                COALESCE(
                  m.manifest -> 'extensions' -> 'familyBoard',
                  '[]'::jsonb
                )
              ) AS contribution(value)
              WHERE contribution.value ->> 'surfaceId' = p.surface_id
              LIMIT 1
            ) AS styles,
            (
              SELECT contribution.value -> 'size'
              FROM jsonb_array_elements(
                COALESCE(
                  m.manifest -> 'extensions' -> 'familyBoard',
                  '[]'::jsonb
                )
              ) AS contribution(value)
              WHERE contribution.value ->> 'surfaceId' = p.surface_id
              LIMIT 1
            ) AS size,
            p.phone_layout AS "phoneLayout",
            p.wide_layout AS "wideLayout",
            p.revision::text AS revision
          FROM core.household_member_module_preferences AS p
          JOIN core.modules AS m
            ON m.id = p.module_id
          JOIN core.household_modules AS hm
            ON hm.household_id = p.household_id
           AND hm.module_id = p.module_id
          WHERE p.id = CAST(${input.entityId} AS uuid)
            AND p.household_id = CAST(${context.householdId} AS uuid)
            AND p.membership_id = CAST(${context.membershipId} AS uuid)
          FOR UPDATE
        `);
        const current =
          currentResult.rows[0] as StoredPreferenceRow | undefined;

        const undeclaredStyle =
          current !== undefined &&
          input.payload.cardStyle !== undefined &&
          !cardStyles(current.styles).some(
            (style) => style.id === input.payload.cardStyle,
          );
        const layoutOutOfBounds =
          current !== undefined &&
          (["phone", "wide"] as const).some((layout) => {
            const value = input.payload[`${layout}Layout`];
            return (
              value !== undefined &&
              value !== null &&
              !withinCardLimits(value, current.size, layout)
            );
          });
        if (!current || undeclaredStyle || layoutOutOfBounds) {
          const errorCode = !current
            ? "MODULE_PREFERENCE_NOT_FOUND"
            : undeclaredStyle
              ? "MODULE_PREFERENCE_CARD_STYLE_UNDECLARED"
              : "MODULE_PREFERENCE_LAYOUT_OUT_OF_BOUNDS";
          const rejectedResult = await tx.execute(sql`
            UPDATE core.sync_mutations
            SET
              status = 'rejected',
              error_code = ${errorCode}
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
            throw new HomiMemberModulePreferenceError(
              500,
              "MUTATION_RESULT_FAILED",
              "The preference rejection could not be saved.",
            );
          }
          return mutationResult(rejected, false);
        }

        if (BigInt(current.revision) !== input.baseRevision) {
          const state = JSON.stringify({
            ...snapshot(current),
            revision: current.revision,
          });
          const conflictResult = await tx.execute(sql`
            UPDATE core.sync_mutations
            SET
              status = 'conflict',
              server_revision = CAST(${current.revision} AS bigint),
              error_code = 'REVISION_CONFLICT',
              result_payload = CAST(${state} AS jsonb)
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
            throw new HomiMemberModulePreferenceError(
              500,
              "MUTATION_RESULT_FAILED",
              "The preference conflict could not be saved.",
            );
          }
          return mutationResult(conflict, false);
        }

        const nextVisible =
          input.payload.visible ?? current.visible;
        const nextDisplayOrder =
          input.payload.displayOrder ?? current.displayOrder;
        const nextCardStyle =
          input.payload.cardStyle ?? current.cardStyle;
        const currentPhoneLayout = placement(current.phoneLayout, "phone");
        const currentWideLayout = placement(current.wideLayout, "wide");
        const nextPhoneLayout =
          input.payload.phoneLayout === undefined
            ? currentPhoneLayout
            : input.payload.phoneLayout;
        const nextWideLayout =
          input.payload.wideLayout === undefined
            ? currentWideLayout
            : input.payload.wideLayout;
        const phoneLayoutJson =
          nextPhoneLayout === null ? null : JSON.stringify(nextPhoneLayout);
        const wideLayoutJson =
          nextWideLayout === null ? null : JSON.stringify(nextWideLayout);

        const updatedResult = await tx.execute(sql`
          UPDATE core.household_member_module_preferences
          SET
            visible = ${nextVisible},
            display_order = ${nextDisplayOrder},
            card_style = ${nextCardStyle},
            phone_layout = CAST(${phoneLayoutJson} AS jsonb),
            wide_layout = CAST(${wideLayoutJson} AS jsonb),
            revision = revision + 1,
            updated_at = now()
          WHERE id = CAST(${current.id} AS uuid)
          RETURNING revision::text AS revision
        `);
        const updated = updatedResult.rows[0] as
          | { revision: string }
          | undefined;
        if (!updated) {
          throw new HomiMemberModulePreferenceError(
            500,
            "MODULE_PREFERENCE_UPDATE_FAILED",
            "The personal module preference could not be updated.",
          );
        }

        const styles = cardStyles(current.styles);
        const serverState = JSON.stringify({
          id: current.id,
          moduleId: current.moduleId,
          moduleKey: current.moduleKey,
          surfaceId: current.surfaceId,
          label: current.label,
          visible: nextVisible,
          displayOrder: nextDisplayOrder,
          cardStyle: effectiveCardStyle(nextCardStyle, styles),
          cardStyles: styles,
          phoneLayout: nextPhoneLayout,
          wideLayout: nextWideLayout,
          revision: updated.revision,
        });
        const auditMetadata = JSON.stringify({
          source: "sync",
          clientMutationId: input.clientMutationId,
          before: {
            visible: current.visible,
            displayOrder: current.displayOrder,
            cardStyle: current.cardStyle,
            phoneLayout: currentPhoneLayout,
            wideLayout: currentWideLayout,
            revision: current.revision,
          },
          after: {
            visible: nextVisible,
            displayOrder: nextDisplayOrder,
            cardStyle: nextCardStyle,
            phoneLayout: nextPhoneLayout,
            wideLayout: nextWideLayout,
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
            'core.member.module-preference.updated',
            'member-module-preference',
            CAST(${current.id} AS uuid),
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
            recipient_user_id,
            client_id
          )
          VALUES (
            CAST(${context.householdId} AS uuid),
            'core',
            'member-module-preference',
            CAST(${current.id} AS uuid),
            'update',
            CAST(${updated.revision} AS bigint),
            CAST(${context.userId} AS uuid),
            CAST(${context.userId} AS uuid),
            CAST(${clientId} AS uuid)
          )
          RETURNING sequence::text AS sequence
        `);
        const change = changeResult.rows[0] as
          | { sequence: string }
          | undefined;
        if (!change) {
          throw new HomiMemberModulePreferenceError(
            500,
            "CHANGE_LOG_FAILED",
            "The preference change could not be recorded.",
          );
        }
        const appliedResult = await tx.execute(sql`
          UPDATE core.sync_mutations
          SET
            status = 'applied',
            server_revision = CAST(${updated.revision} AS bigint),
            change_sequence = CAST(${change.sequence} AS bigint),
            applied_at = now(),
            error_code = NULL,
            result_payload = CAST(${serverState} AS jsonb)
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
          throw new HomiMemberModulePreferenceError(
            500,
            "MUTATION_RESULT_FAILED",
            "The preference mutation result could not be saved.",
          );
        }

        return mutationResult(applied, false);
      });
    },
  });
}
