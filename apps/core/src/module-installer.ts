import { Client, type QueryResultRow } from "pg";
import {
  installPreparedModuleArtifact,
  inspectHomiModulePackage,
  type HomiModuleMigration,
  type HomiPreparedModulePackage,
} from "./module-package.js";

export type HomiModuleRegistryState =
  | "installed"
  | "updating"
  | "disabled"
  | "failed";

export type HomiModuleMigrationState =
  | "pending"
  | "applied"
  | "failed"
  | "rolled_back";

export class HomiModuleInstallError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HomiModuleInstallError";
    this.code = code;
  }
}

export interface HomiModuleRegistrySnapshot {
  readonly moduleId: string;
  readonly publisher: string;
  readonly state: HomiModuleRegistryState;
  readonly currentVersion: string;
  readonly activeVersion: string | null;
  readonly targetDigest: string | null;
  readonly targetMigrationState: HomiModuleMigrationState | null;
}

export type HomiModuleInstallPlan =
  | {
      readonly kind: "fresh-install";
      readonly fromVersion: null;
    }
  | {
      readonly kind: "update";
      readonly fromVersion: string;
    }
  | {
      readonly kind: "retry";
      readonly fromVersion: string | null;
    }
  | {
      readonly kind: "already-installed";
      readonly fromVersion: string;
    };

export interface HomiModuleInstallResult {
  readonly moduleKey: string;
  readonly version: string;
  readonly packageDigest: string;
  readonly artifactDirectory: string;
  readonly status: "installed" | "already-installed";
  readonly fromVersion: string | null;
  readonly appliedMigrations: readonly string[];
}

export interface HomiLegacyModuleAdoptionResult {
  readonly moduleKey: string;
  readonly currentVersion: string;
  readonly candidateVersion: string;
  readonly status: "adopted" | "already-adopted";
  readonly adoptedMigrations: readonly string[];
}

interface RegistryRow extends QueryResultRow {
  module_id: string;
  publisher: string;
  state: HomiModuleRegistryState;
  current_version: string;
  active_version: string | null;
  target_digest: string | null;
  target_migration_state: HomiModuleMigrationState | null;
}

interface BeginInstallResult {
  readonly moduleId: string;
  readonly updateRunId: string;
  readonly priorState: HomiModuleRegistryState | null;
  readonly plan: Exclude<
    HomiModuleInstallPlan,
    { readonly kind: "already-installed" }
  >;
}

interface AppliedMigrationRow extends QueryResultRow {
  id: string;
  checksum: string;
  module_version: string;
}

interface FailedUpdateRow extends QueryResultRow {
  update_run_id: string;
  module_id: string;
  module_state: HomiModuleRegistryState;
  current_version: string;
  from_version: string | null;
  to_version: string;
  migration_state: HomiModuleMigrationState;
}

function parseSemver(value: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly string[];
} {
  const buildIndex = value.indexOf("+");
  const withoutBuild =
    buildIndex < 0 ? value : value.slice(0, buildIndex);
  const prereleaseIndex = withoutBuild.indexOf("-");
  const core =
    prereleaseIndex < 0
      ? withoutBuild
      : withoutBuild.slice(0, prereleaseIndex);
  const prereleaseRaw =
    prereleaseIndex < 0
      ? undefined
      : withoutBuild.slice(prereleaseIndex + 1);
  const parts = core.split(".");

  if (parts.length !== 3) {
    throw new HomiModuleInstallError(
      "MODULE_VERSION_INVALID",
      `Module version '${value}' is not valid semantic versioning.`,
    );
  }

  const numbers = parts.map((part) => Number(part));
  if (
    numbers.some(
      (part) =>
        !Number.isSafeInteger(part) ||
        part < 0,
    )
  ) {
    throw new HomiModuleInstallError(
      "MODULE_VERSION_INVALID",
      `Module version '${value}' is not valid semantic versioning.`,
    );
  }

  return {
    major: numbers[0]!,
    minor: numbers[1]!,
    patch: numbers[2]!,
    prerelease:
      prereleaseRaw === undefined
        ? Object.freeze([])
        : Object.freeze(prereleaseRaw.split(".")),
  };
}

function comparePrerelease(
  left: readonly string[],
  right: readonly string[],
): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];

    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;

    const aNumeric = /^[0-9]+$/.test(a);
    const bNumeric = /^[0-9]+$/.test(b);

    if (aNumeric && bNumeric) {
      const aNumber = BigInt(a);
      const bNumber = BigInt(b);
      return aNumber < bNumber ? -1 : 1;
    }

    if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1;
    }

    return a < b ? -1 : 1;
  }

  return 0;
}

export function compareHomiModuleVersions(
  left: string,
  right: string,
): number {
  const a = parseSemver(left);
  const b = parseSemver(right);

  for (const field of ["major", "minor", "patch"] as const) {
    if (a[field] < b[field]) return -1;
    if (a[field] > b[field]) return 1;
  }

  return comparePrerelease(a.prerelease, b.prerelease);
}

export function planHomiModuleInstall(
  existing: HomiModuleRegistrySnapshot | null,
  candidate: {
    readonly publisher: string;
    readonly version: string;
    readonly packageDigest: string;
  },
): HomiModuleInstallPlan {
  if (!existing) {
    return Object.freeze({
      kind: "fresh-install",
      fromVersion: null,
    });
  }

  if (existing.publisher !== candidate.publisher) {
    throw new HomiModuleInstallError(
      "MODULE_KEY_OWNERSHIP_CONFLICT",
      `Module key is already owned by publisher '${existing.publisher}'.`,
    );
  }

  if (
    existing.targetDigest !== null &&
    existing.targetDigest !== candidate.packageDigest
  ) {
    throw new HomiModuleInstallError(
      "MODULE_VERSION_DIGEST_MISMATCH",
      `Module version '${candidate.version}' already exists with a different package digest.`,
    );
  }

  if (
    existing.currentVersion === candidate.version &&
    existing.targetMigrationState === "applied" &&
    (existing.state === "installed" ||
      existing.state === "disabled")
  ) {
    return Object.freeze({
      kind: "already-installed",
      fromVersion: existing.currentVersion,
    });
  }

  if (existing.activeVersion !== null) {
    const ordering = compareHomiModuleVersions(
      candidate.version,
      existing.activeVersion,
    );

    if (ordering < 0) {
      throw new HomiModuleInstallError(
        "MODULE_VERSION_DOWNGRADE_NOT_ALLOWED",
        `Candidate version '${candidate.version}' must not be older than active version '${existing.activeVersion}'.`,
      );
    }

    if (
      ordering === 0 &&
      existing.targetMigrationState !== "pending" &&
      existing.targetMigrationState !== "failed"
    ) {
      throw new HomiModuleInstallError(
        "MODULE_VERSION_ALREADY_ACTIVE",
        `Candidate version '${candidate.version}' is already the active module version.`,
      );
    }
  }

  if (
    existing.targetMigrationState === "pending" ||
    existing.targetMigrationState === "failed" ||
    existing.targetMigrationState === "rolled_back"
  ) {
    return Object.freeze({
      kind: "retry",
      fromVersion: existing.activeVersion,
    });
  }

  if (existing.activeVersion !== null) {
    return Object.freeze({
      kind: "update",
      fromVersion: existing.activeVersion,
    });
  }

  return Object.freeze({
    kind: "retry",
    fromVersion: null,
  });
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{1,67}$/.test(value)) {
    throw new HomiModuleInstallError(
      "MODULE_DATABASE_SCHEMA_INVALID",
      `Unsafe PostgreSQL identifier '${value}'.`,
    );
  }
  return `"${value}"`;
}

function errorDetails(error: unknown): string {
  const value =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
  return value.slice(0, 4_000);
}

async function registrySnapshot(
  client: Client,
  moduleKey: string,
  targetVersion: string,
): Promise<HomiModuleRegistrySnapshot | null> {
  const result = await client.query<RegistryRow>(
    `
      SELECT
        m.id AS module_id,
        m.publisher,
        m.state,
        m.current_version,
        active.version AS active_version,
        target.package_digest AS target_digest,
        target.migration_state AS target_migration_state
      FROM core.modules AS m
      LEFT JOIN LATERAL (
        SELECT mv.version
        FROM core.module_versions AS mv
        WHERE mv.module_id = m.id
          AND mv.migration_state = 'applied'
          AND mv.retired_at IS NULL
        ORDER BY mv.created_at DESC, mv.id DESC
        LIMIT 1
      ) AS active ON true
      LEFT JOIN core.module_versions AS target
        ON target.module_id = m.id
       AND target.version = $2
      WHERE m.module_key = $1
      LIMIT 1
    `,
    [moduleKey, targetVersion],
  );

  const row = result.rows[0];
  if (!row) return null;

  return Object.freeze({
    moduleId: row.module_id,
    publisher: row.publisher,
    state: row.state,
    currentVersion: row.current_version,
    activeVersion: row.active_version,
    targetDigest: row.target_digest,
    targetMigrationState: row.target_migration_state,
  });
}

async function beginInstall(
  client: Client,
  prepared: HomiPreparedModulePackage,
  plan: Exclude<
    HomiModuleInstallPlan,
    { readonly kind: "already-installed" }
  >,
  existing: HomiModuleRegistrySnapshot | null,
): Promise<BeginInstallResult> {
  await client.query("BEGIN");

  try {
    let moduleId: string;

    if (!existing) {
      const inserted = await client.query<{ id: string }>(
        `
          INSERT INTO core.modules (
            module_key,
            name,
            publisher,
            state,
            current_version,
            manifest
          )
          VALUES ($1, $2, $3, 'updating', $4, $5::jsonb)
          RETURNING id
        `,
        [
          prepared.manifest.moduleKey,
          prepared.manifest.name,
          prepared.manifest.publisher,
          prepared.manifest.version,
          JSON.stringify(prepared.manifest),
        ],
      );
      moduleId = inserted.rows[0]!.id;
    } else {
      moduleId = existing.moduleId;
      await client.query(
        `
          UPDATE core.modules
          SET state = 'updating',
              updated_at = now()
          WHERE id = $1::uuid
        `,
        [moduleId],
      );
    }

    const targetVersion = await client.query<{ id: string }>(
      `
        INSERT INTO core.module_versions (
          module_id,
          version,
          package_digest,
          manifest,
          migration_state,
          retired_at
        )
        VALUES (
          $1::uuid,
          $2,
          $3,
          $4::jsonb,
          'pending',
          NULL
        )
        ON CONFLICT (module_id, version)
        DO UPDATE SET
          manifest = EXCLUDED.manifest,
          migration_state = 'pending',
          retired_at = NULL
        WHERE core.module_versions.package_digest = EXCLUDED.package_digest
        RETURNING id
      `,
      [
        moduleId,
        prepared.manifest.version,
        prepared.packageDigest,
        JSON.stringify(prepared.manifest),
      ],
    );

    if (targetVersion.rowCount !== 1) {
      throw new HomiModuleInstallError(
        "MODULE_VERSION_DIGEST_MISMATCH",
        `Module version '${prepared.manifest.version}' is already registered with a different digest.`,
      );
    }

    const updateRun = await client.query<{ id: string }>(
      `
        INSERT INTO core.update_runs (
          component_type,
          module_id,
          from_version,
          to_version,
          status
        )
        VALUES (
          'module',
          $1::uuid,
          $2,
          $3,
          'running'
        )
        RETURNING id
      `,
      [
        moduleId,
        plan.fromVersion,
        prepared.manifest.version,
      ],
    );

    await client.query("COMMIT");

    return Object.freeze({
      moduleId,
      updateRunId: updateRun.rows[0]!.id,
      priorState: existing?.state ?? null,
      plan,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function migrationMap(
  migrations: readonly HomiModuleMigration[],
): ReadonlyMap<string, HomiModuleMigration> {
  return new Map(
    migrations.map((migration) => [migration.id, migration] as const),
  );
}

async function applyAndComplete(
  client: Client,
  prepared: HomiPreparedModulePackage,
  begin: BeginInstallResult,
): Promise<readonly string[]> {
  await client.query("BEGIN");

  try {
    const appliedIds: string[] = [];

    if (prepared.manifest.database) {
      const schema = quoteIdentifier(
        prepared.manifest.database.schema,
      );

      await client.query(
        `CREATE SCHEMA IF NOT EXISTS ${schema} AUTHORIZATION homi_owner`,
      );
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
          id text PRIMARY KEY,
          checksum text NOT NULL,
          module_version text NOT NULL,
          applied_at timestamptz(3) NOT NULL DEFAULT now()
        )
      `);

      const applied = await client.query<AppliedMigrationRow>(
        `
          SELECT id, checksum, module_version
          FROM ${schema}.schema_migrations
          ORDER BY id
        `,
      );
      const candidateMigrations = migrationMap(
        prepared.migrations,
      );

      for (const row of applied.rows) {
        const candidate = candidateMigrations.get(row.id);
        if (!candidate) {
          throw new HomiModuleInstallError(
            "MODULE_MIGRATION_HISTORY_MISSING",
            `Previously applied migration '${row.id}' is missing from candidate package.`,
          );
        }
        if (candidate.checksum !== row.checksum) {
          throw new HomiModuleInstallError(
            "MODULE_MIGRATION_HISTORY_CHANGED",
            `Previously applied migration '${row.id}' has changed checksum.`,
          );
        }
      }

      const alreadyApplied = new Set(
        applied.rows.map((row) => row.id),
      );

      await client.query(
        `SET LOCAL search_path TO ${schema}, pg_catalog`,
      );

      for (const migration of prepared.migrations) {
        if (alreadyApplied.has(migration.id)) continue;

        await client.query(migration.sql);
        await client.query(
          `
            INSERT INTO ${schema}.schema_migrations (
              id,
              checksum,
              module_version
            )
            VALUES ($1, $2, $3)
          `,
          [
            migration.id,
            migration.checksum,
            prepared.manifest.version,
          ],
        );
        appliedIds.push(migration.id);
      }

      await client.query(
        `GRANT USAGE ON SCHEMA ${schema} TO homi_app`,
      );
      await client.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO homi_app`,
      );
      await client.query(
        `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${schema} TO homi_app`,
      );
      await client.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE homi_owner IN SCHEMA ${schema} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO homi_app`,
      );
      await client.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE homi_owner IN SCHEMA ${schema} GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO homi_app`,
      );
    }

    if (
      begin.plan.fromVersion !== null &&
      begin.plan.fromVersion !== prepared.manifest.version
    ) {
      await client.query(
        `
          UPDATE core.module_versions
          SET retired_at = now()
          WHERE module_id = $1::uuid
            AND version = $2
            AND migration_state = 'applied'
        `,
        [begin.moduleId, begin.plan.fromVersion],
      );
    }

    await client.query(
      `
        UPDATE core.module_versions
        SET migration_state = 'applied',
            retired_at = NULL
        WHERE module_id = $1::uuid
          AND version = $2
          AND package_digest = $3
      `,
      [
        begin.moduleId,
        prepared.manifest.version,
        prepared.packageDigest,
      ],
    );

    await client.query(
      `
        UPDATE core.modules
        SET name = $2,
            publisher = $3,
            state = $6,
            current_version = $4,
            manifest = $5::jsonb,
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [
        begin.moduleId,
        prepared.manifest.name,
        prepared.manifest.publisher,
        prepared.manifest.version,
        JSON.stringify(prepared.manifest),
        begin.priorState === "disabled"
          ? "disabled"
          : "installed",
      ],
    );

    await client.query(
      `
        UPDATE core.update_runs
        SET status = 'complete',
            completed_at = now(),
            error_details = NULL
        WHERE id = $1::uuid
      `,
      [begin.updateRunId],
    );

    await client.query("COMMIT");
    return Object.freeze(appliedIds);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function markFailed(
  client: Client,
  prepared: HomiPreparedModulePackage,
  begin: BeginInstallResult,
  error: unknown,
): Promise<void> {
  await client.query("BEGIN");

  try {
    await client.query(
      `
        UPDATE core.module_versions
        SET migration_state = 'failed',
            retired_at = now()
        WHERE module_id = $1::uuid
          AND version = $2
          AND package_digest = $3
      `,
      [
        begin.moduleId,
        prepared.manifest.version,
        prepared.packageDigest,
      ],
    );

    if (begin.plan.fromVersion === null) {
      await client.query(
        `
          UPDATE core.modules
          SET state = 'failed',
              updated_at = now()
          WHERE id = $1::uuid
        `,
        [begin.moduleId],
      );
    } else {
      await client.query(
        `
          UPDATE core.modules
          SET state = $3,
              current_version = $2,
              updated_at = now()
          WHERE id = $1::uuid
        `,
        [
          begin.moduleId,
          begin.plan.fromVersion,
          begin.priorState === "disabled"
            ? "disabled"
            : "installed",
        ],
      );
    }

    await client.query(
      `
        UPDATE core.update_runs
        SET status = 'failed',
            completed_at = now(),
            error_details = $2
        WHERE id = $1::uuid
      `,
      [begin.updateRunId, errorDetails(error)],
    );

    await client.query("COMMIT");
  } catch (markError) {
    await client.query("ROLLBACK");
    throw new HomiModuleInstallError(
      "MODULE_INSTALL_FAILURE_RECORDING_FAILED",
      "Module installation failed and Homi could not persist the failure state.",
      { cause: markError },
    );
  }
}

async function lockModule(
  client: Client,
  moduleKey: string,
): Promise<void> {
  await client.query(
    "SELECT pg_advisory_lock(hashtext($1))",
    [`homi-module:${moduleKey}`],
  );
}

async function unlockModule(
  client: Client,
  moduleKey: string,
): Promise<void> {
  await client.query(
    "SELECT pg_advisory_unlock(hashtext($1))",
    [`homi-module:${moduleKey}`],
  );
}

export async function installHomiModule(input: {
  readonly packageDirectory: string;
  readonly installRoot: string;
  readonly databaseUrl: string;
}): Promise<HomiModuleInstallResult> {
  if (!input.databaseUrl.trim()) {
    throw new HomiModuleInstallError(
      "MODULE_INSTALL_DATABASE_URL_REQUIRED",
      "A migrator database URL is required.",
    );
  }

  const prepared = await inspectHomiModulePackage(
    input.packageDirectory,
  );
  const artifactDirectory =
    await installPreparedModuleArtifact(
      prepared,
      input.installRoot,
    );

  const client = new Client({
    connectionString: input.databaseUrl,
    connectionTimeoutMillis: 5_000,
  });

  await client.connect();
  let locked = false;

  try {
    await client.query("SET ROLE homi_owner");
    await lockModule(client, prepared.manifest.moduleKey);
    locked = true;

    const existing = await registrySnapshot(
      client,
      prepared.manifest.moduleKey,
      prepared.manifest.version,
    );
    const plan = planHomiModuleInstall(existing, {
      publisher: prepared.manifest.publisher,
      version: prepared.manifest.version,
      packageDigest: prepared.packageDigest,
    });

    if (plan.kind === "already-installed") {
      if (existing?.state === "disabled") {
        await client.query(
          `UPDATE core.modules
           SET state = 'installed', updated_at = now()
           WHERE id = $1::uuid`,
          [existing.moduleId],
        );
      }
      return Object.freeze({
        moduleKey: prepared.manifest.moduleKey,
        version: prepared.manifest.version,
        packageDigest: prepared.packageDigest,
        artifactDirectory,
        status: "already-installed",
        fromVersion: plan.fromVersion,
        appliedMigrations: Object.freeze([]),
      });
    }

    const begin = await beginInstall(
      client,
      prepared,
      plan,
      existing,
    );

    try {
      const appliedMigrations = await applyAndComplete(
        client,
        prepared,
        begin,
      );

      return Object.freeze({
        moduleKey: prepared.manifest.moduleKey,
        version: prepared.manifest.version,
        packageDigest: prepared.packageDigest,
        artifactDirectory,
        status: "installed",
        fromVersion: plan.fromVersion,
        appliedMigrations,
      });
    } catch (error) {
      await markFailed(client, prepared, begin, error);
      throw new HomiModuleInstallError(
        "MODULE_INSTALL_FAILED",
        `Module '${prepared.manifest.moduleKey}' version '${prepared.manifest.version}' failed to install.`,
        { cause: error },
      );
    }
  } finally {
    if (locked) {
      await unlockModule(
        client,
        prepared.manifest.moduleKey,
      ).catch(() => undefined);
    }
    await client.query("RESET ROLE").catch(() => undefined);
    await client.end();
  }
}

export async function adoptLegacyHomiModule(input: {
  readonly packageDirectory: string;
  readonly databaseUrl: string;
}): Promise<HomiLegacyModuleAdoptionResult> {
  if (!input.databaseUrl.trim()) {
    throw new HomiModuleInstallError(
      "MODULE_INSTALL_DATABASE_URL_REQUIRED",
      "A migrator database URL is required.",
    );
  }

  const prepared = await inspectHomiModulePackage(
    input.packageDirectory,
  );
  const databaseManifest = prepared.manifest.database;
  if (!databaseManifest) {
    throw new HomiModuleInstallError(
      "MODULE_LEGACY_ADOPTION_DATABASE_REQUIRED",
      "Legacy adoption requires a database-backed module package.",
    );
  }

  const client = new Client({
    connectionString: input.databaseUrl,
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  let locked = false;

  try {
    await client.query("SET ROLE homi_owner");
    await lockModule(client, prepared.manifest.moduleKey);
    locked = true;

    const existing = await registrySnapshot(
      client,
      prepared.manifest.moduleKey,
      prepared.manifest.version,
    );
    if (!existing) {
      throw new HomiModuleInstallError(
        "MODULE_LEGACY_ADOPTION_REGISTRY_MISSING",
        `Module '${prepared.manifest.moduleKey}' is not registered and cannot be adopted.`,
      );
    }

    const plan = planHomiModuleInstall(existing, {
      publisher: prepared.manifest.publisher,
      version: prepared.manifest.version,
      packageDigest: prepared.packageDigest,
    });
    if (plan.kind !== "update") {
      throw new HomiModuleInstallError(
        "MODULE_LEGACY_ADOPTION_UPDATE_REQUIRED",
        "Legacy adoption requires a candidate package newer than the currently installed module.",
      );
    }
    if (
      existing.state !== "installed" &&
      existing.state !== "disabled"
    ) {
      throw new HomiModuleInstallError(
        "MODULE_LEGACY_ADOPTION_STATE_INVALID",
        `Module '${prepared.manifest.moduleKey}' must be installed or disabled before legacy adoption.`,
      );
    }

    const schema = quoteIdentifier(databaseManifest.schema);
    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = $1
         AND table_name = 'schema_migrations'
       ORDER BY ordinal_position`,
      [databaseManifest.schema],
    );
    const columnNames = new Set(
      columns.rows.map((row) => row.column_name),
    );
    if (!columnNames.has("id") || !columnNames.has("applied_at")) {
      throw new HomiModuleInstallError(
        "MODULE_LEGACY_ADOPTION_LEDGER_INVALID",
        "The existing module migration ledger is missing its legacy identity columns.",
      );
    }

    const hasChecksum = columnNames.has("checksum");
    const hasModuleVersion = columnNames.has("module_version");
    if (hasChecksum !== hasModuleVersion) {
      throw new HomiModuleInstallError(
        "MODULE_LEGACY_ADOPTION_LEDGER_PARTIAL",
        "The module migration ledger is partially upgraded and cannot be adopted automatically.",
      );
    }

    const candidate = migrationMap(prepared.migrations);
    const legacyRows = await client.query<{ id: string }>(
      `SELECT id FROM ${schema}.schema_migrations ORDER BY id`,
    );
    const legacyIds = legacyRows.rows.map((row) => row.id);

    if (hasChecksum && hasModuleVersion) {
      const applied = await client.query<AppliedMigrationRow>(
        `SELECT id, checksum, module_version
         FROM ${schema}.schema_migrations
         ORDER BY id`,
      );
      for (const row of applied.rows) {
        const migration = candidate.get(row.id);
        if (!migration) {
          throw new HomiModuleInstallError(
            "MODULE_MIGRATION_HISTORY_MISSING",
            `Previously applied migration '${row.id}' is missing from candidate package.`,
          );
        }
        if (migration.checksum !== row.checksum) {
          throw new HomiModuleInstallError(
            "MODULE_MIGRATION_HISTORY_CHANGED",
            `Previously applied migration '${row.id}' has changed checksum.`,
          );
        }
      }
      return Object.freeze({
        moduleKey: prepared.manifest.moduleKey,
        currentVersion: existing.currentVersion,
        candidateVersion: prepared.manifest.version,
        status: "already-adopted",
        adoptedMigrations: Object.freeze(
          applied.rows.map((row) => row.id),
        ),
      });
    }

    if (legacyIds.length === 0) {
      throw new HomiModuleInstallError(
        "MODULE_LEGACY_ADOPTION_HISTORY_EMPTY",
        "Legacy adoption requires an existing applied migration history.",
      );
    }

    const candidateIds = prepared.migrations.map(
      (migration) => migration.id,
    );
    if (legacyIds.length > candidateIds.length) {
      throw new HomiModuleInstallError(
        "MODULE_MIGRATION_HISTORY_MISSING",
        "The candidate package is missing part of the legacy migration history.",
      );
    }
    for (let index = 0; index < legacyIds.length; index += 1) {
      if (legacyIds[index] !== candidateIds[index]) {
        throw new HomiModuleInstallError(
          "MODULE_LEGACY_ADOPTION_HISTORY_MISMATCH",
          "The legacy migration IDs are not an exact leading prefix of the candidate package history.",
        );
      }
    }

    await client.query("BEGIN");
    try {
      await client.query(
        `ALTER TABLE ${schema}.schema_migrations
           ADD COLUMN checksum text,
           ADD COLUMN module_version text`,
      );
      for (const id of legacyIds) {
        const migration = candidate.get(id)!;
        await client.query(
          `UPDATE ${schema}.schema_migrations
           SET checksum = $2,
               module_version = $3
           WHERE id = $1`,
          [id, migration.checksum, existing.currentVersion],
        );
      }
      await client.query(
        `ALTER TABLE ${schema}.schema_migrations
           ALTER COLUMN checksum SET NOT NULL,
           ALTER COLUMN module_version SET NOT NULL`,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }

    return Object.freeze({
      moduleKey: prepared.manifest.moduleKey,
      currentVersion: existing.currentVersion,
      candidateVersion: prepared.manifest.version,
      status: "adopted",
      adoptedMigrations: Object.freeze([...legacyIds]),
    });
  } finally {
    if (locked) {
      await unlockModule(
        client,
        prepared.manifest.moduleKey,
      ).catch(() => undefined);
    }
    await client.query("RESET ROLE").catch(() => undefined);
    await client.end();
  }
}

export async function recoverFailedHomiModuleUpdate(input: {
  readonly moduleKey: string;
  readonly targetVersion: string;
  readonly databaseUrl: string;
}): Promise<{
  readonly moduleKey: string;
  readonly targetVersion: string;
  readonly restoredVersion: string | null;
}> {
  if (!input.databaseUrl.trim()) {
    throw new HomiModuleInstallError(
      "MODULE_INSTALL_DATABASE_URL_REQUIRED",
      "A migrator database URL is required.",
    );
  }

  if (!/^[a-z][a-z0-9-]{1,63}$/.test(input.moduleKey)) {
    throw new HomiModuleInstallError(
      "MODULE_KEY_INVALID",
      "moduleKey is invalid.",
    );
  }

  parseSemver(input.targetVersion);

  const client = new Client({
    connectionString: input.databaseUrl,
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  let locked = false;

  try {
    await client.query("SET ROLE homi_owner");
    await lockModule(client, input.moduleKey);
    locked = true;

    const result = await client.query<FailedUpdateRow>(
      `
        SELECT
          ur.id AS update_run_id,
          m.id AS module_id,
          m.state AS module_state,
          m.current_version,
          ur.from_version,
          ur.to_version,
          mv.migration_state
        FROM core.update_runs AS ur
        INNER JOIN core.modules AS m
          ON m.id = ur.module_id
        INNER JOIN core.module_versions AS mv
          ON mv.module_id = m.id
         AND mv.version = ur.to_version
        WHERE m.module_key = $1
          AND ur.component_type = 'module'
          AND ur.to_version = $2
          AND ur.status = 'failed'
        ORDER BY ur.started_at DESC, ur.id DESC
        LIMIT 1
      `,
      [input.moduleKey, input.targetVersion],
    );

    const row = result.rows[0];
    if (!row) {
      throw new HomiModuleInstallError(
        "MODULE_FAILED_UPDATE_NOT_FOUND",
        "No matching failed module update is available for recovery.",
      );
    }

    await client.query("BEGIN");
    try {
      await client.query(
        `
          UPDATE core.module_versions
          SET migration_state = 'rolled_back',
              retired_at = COALESCE(retired_at, now())
          WHERE module_id = $1::uuid
            AND version = $2
            AND migration_state = 'failed'
        `,
        [row.module_id, row.to_version],
      );

      if (row.from_version !== null) {
        await client.query(
          `
            UPDATE core.module_versions
            SET retired_at = NULL
            WHERE module_id = $1::uuid
              AND version = $2
              AND migration_state = 'applied'
          `,
          [row.module_id, row.from_version],
        );
        await client.query(
          `
            UPDATE core.modules
            SET state = CASE
                  WHEN state = 'disabled' THEN 'disabled'
                  ELSE 'installed'
                END,
                current_version = $2,
                updated_at = now()
            WHERE id = $1::uuid
          `,
          [row.module_id, row.from_version],
        );
      } else {
        await client.query(
          `
            UPDATE core.modules
            SET state = 'failed',
                updated_at = now()
            WHERE id = $1::uuid
          `,
          [row.module_id],
        );
      }

      await client.query(
        `
          UPDATE core.update_runs
          SET status = 'rolled_back',
              completed_at = now()
          WHERE id = $1::uuid
        `,
        [row.update_run_id],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    return Object.freeze({
      moduleKey: input.moduleKey,
      targetVersion: input.targetVersion,
      restoredVersion: row.from_version,
    });
  } finally {
    if (locked) {
      await unlockModule(client, input.moduleKey).catch(
        () => undefined,
      );
    }
    await client.query("RESET ROLE").catch(() => undefined);
    await client.end();
  }
}
