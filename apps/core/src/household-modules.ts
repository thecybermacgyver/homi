import { sql } from "drizzle-orm";
import type { HomiDatabase } from "@homi/db";
import {
  HOMI_MODULE_API_VERSION,
  assertHomiModuleCompatibility,
  parseHomiModuleManifest,
  type HomiModuleManifest,
  type HomiModuleSetupState,
  type HomiRequestContext,
} from "@homi/module-sdk";
import type { HomiRuntimeModule } from "./module-host.js";

export type HomiHouseholdModuleSetupState =
  | "not-required"
  | HomiModuleSetupState
  | "unavailable";

export interface HomiHouseholdModuleSummary {
  readonly id: string;
  readonly moduleKey: string;
  readonly name: string;
  readonly publisher: string;
  readonly version: string;
  readonly globalState: string;
  readonly available: boolean;
  readonly enabled: boolean;
  readonly revision: bigint;
  readonly setupRequired: boolean | null;
  readonly setupState: HomiHouseholdModuleSetupState;
}

export interface SetHomiHouseholdModuleEnabledInput {
  readonly enabled: boolean;
  readonly baseRevision: bigint;
}

export interface HomiHouseholdModuleRuntimeDescriptor {
  readonly id: string;
  readonly moduleKey: string;
  readonly revision: string;
  readonly enabled: boolean;
  readonly manifest: Readonly<HomiModuleManifest>;
  readonly webEntrypointUrl: string;
  readonly setupState: HomiHouseholdModuleSetupState;
}

export interface HomiHouseholdModuleService {
  list(
    context: HomiRequestContext,
  ): Promise<readonly HomiHouseholdModuleSummary[]>;

  runtime(
    context: HomiRequestContext,
  ): Promise<readonly HomiHouseholdModuleRuntimeDescriptor[]>;

  setEnabled(
    context: HomiRequestContext,
    moduleKey: string,
    input: SetHomiHouseholdModuleEnabledInput,
  ): Promise<HomiHouseholdModuleSummary>;
}

export class HomiHouseholdModuleError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HomiHouseholdModuleError";
  }
}

interface ModuleCatalogRow {
  id: string;
  moduleKey: string;
  name: string;
  publisher: string;
  version: string;
  globalState: string;
  manifest: unknown;
  enabled: boolean | null;
  revision: string | null;
}

function setupRequired(manifest: unknown): boolean | null {
  try {
    return parseHomiModuleManifest(manifest).setup?.required ?? false;
  } catch {
    // Pre-platform modules may have legacy registry manifests. They remain
    // visible, but Core must not invent setup requirements from incomplete JSON.
    return null;
  }
}

function runtimeMap(
  modules: readonly HomiRuntimeModule[],
): ReadonlyMap<string, HomiRuntimeModule> {
  return new Map(
    modules.map((module) => [module.moduleKey, module] as const),
  );
}

async function setupState(
  context: HomiRequestContext,
  row: ModuleCatalogRow,
  required: boolean | null,
  runtimes: ReadonlyMap<string, HomiRuntimeModule>,
): Promise<HomiHouseholdModuleSetupState> {
  if (required === null) return "unavailable";
  if (required === false) return "not-required";
  if (row.globalState !== "installed") {
    return "unavailable";
  }

  const runtime = runtimes.get(row.moduleKey);
  if (!runtime?.getSetupStatus) return "unavailable";

  try {
    const status = await runtime.getSetupStatus(context);
    return status.state === "configured" ||
      status.state === "unconfigured"
      ? status.state
      : "unavailable";
  } catch {
    // A module setup-status failure must not take down the Homi module catalog.
    return "unavailable";
  }
}

async function projectSummary(
  context: HomiRequestContext,
  row: ModuleCatalogRow,
  runtimes: ReadonlyMap<string, HomiRuntimeModule>,
): Promise<HomiHouseholdModuleSummary> {
  const required = setupRequired(row.manifest);

  return Object.freeze({
    id: row.id,
    moduleKey: row.moduleKey,
    name: row.name,
    publisher: row.publisher,
    version: row.version,
    globalState: row.globalState,
    available: row.globalState === "installed",
    enabled: row.enabled === true,
    revision: BigInt(row.revision ?? "0"),
    setupRequired: required,
    setupState: await setupState(
      context,
      row,
      required,
      runtimes,
    ),
  });
}

function assetUrl(
  moduleKey: string,
  version: string,
  packagePath: string,
): string {
  const path = packagePath
    .slice(2)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

  return [
    "/api/v1/core/module-assets",
    encodeURIComponent(moduleKey),
    encodeURIComponent(version),
    path,
  ].join("/");
}

async function projectRuntime(
  context: HomiRequestContext,
  row: ModuleCatalogRow,
  runtimes: ReadonlyMap<string, HomiRuntimeModule>,
): Promise<HomiHouseholdModuleRuntimeDescriptor | null> {
  if (
    row.globalState !== "installed" ||
    row.revision === null
  ) {
    return null;
  }

  try {
    const manifest = parseHomiModuleManifest(row.manifest);
    assertHomiModuleCompatibility(
      manifest,
      HOMI_MODULE_API_VERSION,
    );

    const webEntrypoint = manifest.entrypoints.web;
    if (!webEntrypoint) return null;

    const required = manifest.setup?.required ?? false;

    return Object.freeze({
      id: row.id,
      moduleKey: row.moduleKey,
      revision: row.revision,
      enabled: row.enabled === true,
      manifest,
      webEntrypointUrl: assetUrl(
        row.moduleKey,
        row.version,
        webEntrypoint,
      ),
      setupState: await setupState(
        context,
        row,
        required,
        runtimes,
      ),
    });
  } catch {
    return null;
  }
}

export function createHomiHouseholdModuleService(
  database: HomiDatabase["db"],
  modules: readonly HomiRuntimeModule[] = [],
): HomiHouseholdModuleService {
  const runtimes = runtimeMap(modules);

  async function listRows(
    context: HomiRequestContext,
  ): Promise<ModuleCatalogRow[]> {
    const result = await database.execute(sql`
      SELECT
        m.id,
        m.module_key AS "moduleKey",
        m.name,
        m.publisher,
        m.current_version AS "version",
        m.state AS "globalState",
        m.manifest,
        hm.enabled,
        hm.revision::text AS revision
      FROM core.modules AS m
      LEFT JOIN core.household_modules AS hm
        ON hm.module_id = m.id
       AND hm.household_id =
         CAST(${context.householdId} AS uuid)
      WHERE m.state <> 'disabled'
      ORDER BY m.name, m.module_key
    `);

    return result.rows as unknown as ModuleCatalogRow[];
  }

  async function rowByKey(
    context: HomiRequestContext,
    moduleKey: string,
  ): Promise<ModuleCatalogRow | null> {
    const result = await database.execute(sql`
      SELECT
        m.id,
        m.module_key AS "moduleKey",
        m.name,
        m.publisher,
        m.current_version AS "version",
        m.state AS "globalState",
        m.manifest,
        hm.enabled,
        hm.revision::text AS revision
      FROM core.modules AS m
      LEFT JOIN core.household_modules AS hm
        ON hm.module_id = m.id
       AND hm.household_id =
         CAST(${context.householdId} AS uuid)
      WHERE m.module_key = ${moduleKey}
      LIMIT 1
    `);

    return (
      (result.rows[0] as unknown as ModuleCatalogRow | undefined) ??
      null
    );
  }

  return Object.freeze({
    async list(context: HomiRequestContext) {
      const rows = await listRows(context);

      return Object.freeze(
        await Promise.all(
          rows.map((row) =>
            projectSummary(
              context,
              row,
              runtimes,
            ),
          ),
        ),
      );
    },

    async runtime(context: HomiRequestContext) {
      const rows = await listRows(context);
      const projected = await Promise.all(
        rows.map((row) =>
          projectRuntime(
            context,
            row,
            runtimes,
          ),
        ),
      );

      return Object.freeze(
        projected.filter(
          (
            module,
          ): module is HomiHouseholdModuleRuntimeDescriptor =>
            module !== null,
        ),
      );
    },

    async setEnabled(
      context: HomiRequestContext,
      moduleKey: string,
      input: SetHomiHouseholdModuleEnabledInput,
    ) {
      if (!/^[a-z][a-z0-9-]{1,63}$/.test(moduleKey)) {
        throw new HomiHouseholdModuleError(
          400,
          "MODULE_KEY_INVALID",
          "The module key is invalid.",
        );
      }

      if (input.baseRevision < 0n) {
        throw new HomiHouseholdModuleError(
          400,
          "MODULE_REVISION_INVALID",
          "baseRevision must be non-negative.",
        );
      }

      await database.transaction(async (tx) => {
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(
              ${`household-modules:${context.householdId}`},
              0
            )
          )
        `);

        const currentResult = await tx.execute(sql`
          SELECT
            m.id,
            m.module_key AS "moduleKey",
            m.state AS "globalState",
            m.manifest,
            hm.enabled,
            hm.revision::text AS revision
          FROM core.modules AS m
          LEFT JOIN core.household_modules AS hm
            ON hm.module_id = m.id
           AND hm.household_id =
             CAST(${context.householdId} AS uuid)
          WHERE m.module_key = ${moduleKey}
          LIMIT 1
        `);

        const current = currentResult.rows[0] as
          | {
              id: string;
              moduleKey: string;
              globalState: string;
              manifest: unknown;
              enabled: boolean | null;
              revision: string | null;
            }
          | undefined;

        if (!current) {
          throw new HomiHouseholdModuleError(
            404,
            "MODULE_NOT_FOUND",
            "The module is not installed in Homi.",
          );
        }

        if (current.globalState !== "installed") {
          throw new HomiHouseholdModuleError(
            409,
            "MODULE_UNAVAILABLE",
            "The module is not currently available for households.",
          );
        }

        const currentRevision = BigInt(current.revision ?? "0");
        const currentEnabled = current.enabled === true;

        if (currentRevision !== input.baseRevision) {
          throw new HomiHouseholdModuleError(
            409,
            "REVISION_CONFLICT",
            "The household module state changed since it was loaded.",
          );
        }

        if (currentEnabled === input.enabled) {
          return;
        }

        let nextRevision: bigint;
        let operation: "create" | "update";

        if (current.revision === null) {
          if (!input.enabled) return;

          const inserted = await tx.execute(sql`
            INSERT INTO core.household_modules (
              household_id,
              module_id,
              enabled,
              enabled_at,
              disabled_at,
              enabled_by_user_id,
              revision
            )
            VALUES (
              CAST(${context.householdId} AS uuid),
              CAST(${current.id} AS uuid),
              true,
              now(),
              NULL,
              CAST(${context.userId} AS uuid),
              1
            )
            RETURNING revision::text AS revision
          `);

          const revision = inserted.rows[0] as
            | { revision: string }
            | undefined;

          if (!revision) {
            throw new HomiHouseholdModuleError(
              500,
              "MODULE_ENABLE_FAILED",
              "The household module could not be enabled.",
            );
          }

          nextRevision = BigInt(revision.revision);
          operation = "create";
        } else {
          const updated = await tx.execute(sql`
            UPDATE core.household_modules
            SET
              enabled = ${input.enabled},
              enabled_at = CASE
                WHEN ${input.enabled} THEN now()
                ELSE enabled_at
              END,
              disabled_at = CASE
                WHEN ${input.enabled} THEN NULL
                ELSE now()
              END,
              enabled_by_user_id = CASE
                WHEN ${input.enabled}
                  THEN CAST(${context.userId} AS uuid)
                ELSE enabled_by_user_id
              END,
              revision = revision + 1
            WHERE household_id =
                CAST(${context.householdId} AS uuid)
              AND module_id = CAST(${current.id} AS uuid)
            RETURNING revision::text AS revision
          `);

          const revision = updated.rows[0] as
            | { revision: string }
            | undefined;

          if (!revision) {
            throw new HomiHouseholdModuleError(
              500,
              "MODULE_STATE_UPDATE_FAILED",
              "The household module state could not be updated.",
            );
          }

          nextRevision = BigInt(revision.revision);
          operation = "update";
        }

        const auditMetadata = JSON.stringify({
          moduleKey,
          enabled: input.enabled,
          revision: nextRevision.toString(),
        });
        const eventType = input.enabled
          ? "core.household.module.enabled"
          : "core.household.module.disabled";

        await tx.execute(sql`
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
            'household-module',
            CAST(${current.id} AS uuid),
            ${operation},
            CAST(${nextRevision.toString()} AS bigint),
            CAST(${context.userId} AS uuid),
            CAST(${context.clientId ?? null} AS uuid)
          )
        `);

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
            CAST(${context.clientId ?? null} AS uuid),
            ${eventType},
            'household-module',
            CAST(${current.id} AS uuid),
            'core',
            ${context.requestId},
            CAST(${auditMetadata} AS jsonb)
          )
        `);

        await tx.execute(sql`
          INSERT INTO core.event_outbox (
            household_id,
            source_module_key,
            event_type,
            aggregate_type,
            aggregate_id,
            payload
          )
          VALUES (
            CAST(${context.householdId} AS uuid),
            'core',
            ${eventType},
            'household-module',
            CAST(${current.id} AS uuid),
            CAST(${auditMetadata} AS jsonb)
          )
        `);
      });

      const updated = await rowByKey(context, moduleKey);

      if (!updated) {
        throw new HomiHouseholdModuleError(
          500,
          "MODULE_STATE_READ_FAILED",
          "The updated household module state could not be read.",
        );
      }

      return projectSummary(
      context,
      updated,
      runtimes,
      );
    },
  });
}
