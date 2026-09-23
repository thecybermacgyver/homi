import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  HomiModulePackageError,
  inspectHomiModulePackage,
  installPreparedModuleArtifact,
  validateModuleMigrationSql,
} from "../dist/module-package.js";
import {
  HomiModuleInstallError,
  compareHomiModuleVersions,
  planHomiModuleInstall,
} from "../dist/module-installer.js";

const templateDirectory = fileURLToPath(
  new URL(
    "../../../templates/homi-module-template/",
    import.meta.url,
  ),
);

function errorCode(error, code) {
  return (
    (error instanceof HomiModulePackageError ||
      error instanceof HomiModuleInstallError) &&
    error.code === code
  );
}

async function copyPrepared(prepared, destination) {
  await mkdir(destination, { recursive: true });
  for (const file of prepared.files) {
    const target = join(destination, file.relativePath);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(file.absolutePath, target);
  }
}

const temp = await mkdtemp(
  join(tmpdir(), "homi-module-platform-"),
);
const coreRoot = fileURLToPath(
  new URL("../", import.meta.url),
);
const runtimeRoot = await mkdtemp(
  join(coreRoot, ".homi-modules-test-"),
);

try {
  const prepared = await inspectHomiModulePackage(
    templateDirectory,
  );

  assert.equal(prepared.manifest.moduleKey, "starter");
  assert.equal(prepared.manifest.version, "0.1.0");
  assert.equal(prepared.manifest.database?.schema, "mod_starter");
  assert.equal(prepared.migrations.length, 1);
  assert.match(prepared.packageDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(
    prepared.migrations[0]?.checksum ?? "",
    /^sha256:[0-9a-f]{64}$/,
  );

  const installRoot = join(temp, "installed");
  const installedDirectory =
    await installPreparedModuleArtifact(
      prepared,
      installRoot,
    );
  assert.equal(
    installedDirectory,
    join(installRoot, "starter", "0.1.0"),
  );

  const installed =
    await inspectHomiModulePackage(installedDirectory);
  assert.equal(
    installed.packageDigest,
    prepared.packageDigest,
  );

  const idempotent =
    await installPreparedModuleArtifact(
      prepared,
      installRoot,
    );
  assert.equal(idempotent, installedDirectory);

  const changedSource = join(temp, "changed-source");
  await copyPrepared(prepared, changedSource);
  const localePath = join(changedSource, "locales", "en.json");
  const locale = await readFile(localePath, "utf8");
  await writeFile(
    localePath,
    locale.replace(
      '"module.name": "Starter"',
      '"module.name": "Changed Starter"',
    ),
  );

  const changed = await inspectHomiModulePackage(
    changedSource,
  );
  assert.notEqual(changed.packageDigest, prepared.packageDigest);
  await assert.rejects(
    () =>
      installPreparedModuleArtifact(
        changed,
        installRoot,
      ),
    (error) =>
      errorCode(error, "MODULE_VERSION_DIGEST_MISMATCH"),
  );

  const bareImportSource = join(temp, "bare-import-source");
  await copyPrepared(prepared, bareImportSource);
  const serverPath = join(bareImportSource, "dist", "server.js");
  const serverSource = await readFile(serverPath, "utf8");
  await writeFile(
    serverPath,
    `import "unresolved-runtime-package";\n${serverSource}`,
  );
  await assert.rejects(
    () => inspectHomiModulePackage(bareImportSource),
    (error) =>
      errorCode(error, "MODULE_SERVER_BARE_IMPORT_FORBIDDEN"),
  );

  const badVersionSource = join(temp, "bad-version");
  await copyPrepared(prepared, badVersionSource);
  const packageJsonPath = join(
    badVersionSource,
    "package.json",
  );
  const packageJson = JSON.parse(
    await readFile(packageJsonPath, "utf8"),
  );
  packageJson.version = "0.1.1";
  await writeFile(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2) + "\n",
  );
  await assert.rejects(
    () => inspectHomiModulePackage(badVersionSource),
    (error) =>
      errorCode(error, "MODULE_PACKAGE_VERSION_MISMATCH"),
  );

  const symlinkSource = join(temp, "symlink-source");
  await copyPrepared(prepared, symlinkSource);
  await symlink(
    "/tmp",
    join(symlinkSource, "unsafe-link"),
  );
  await assert.rejects(
    () => inspectHomiModulePackage(symlinkSource),
    (error) =>
      errorCode(error, "MODULE_PACKAGE_SYMLINK_FORBIDDEN"),
  );

  const validSql = `
    CREATE TABLE IF NOT EXISTS mod_starter.sample (
      id uuid PRIMARY KEY,
      note text
    );
    INSERT INTO mod_starter.sample (id, note)
    VALUES ('00000000-0000-4000-8000-000000000001', 'core.modules is text');
  `;
  validateModuleMigrationSql(
    validSql,
    "mod_starter",
    "0001_valid.sql",
  );

  const invalidMigrations = [
    [
      "MODULE_MIGRATION_SCHEMA_VIOLATION",
      "SELECT * FROM core.modules;",
    ],
    [
      "MODULE_MIGRATION_CROSS_MODULE_REFERENCE",
      "SELECT * FROM mod_calendar.events;",
    ],
    [
      "MODULE_MIGRATION_OPERATION_FORBIDDEN",
      "ALTER TABLE mod_starter.sample SET SCHEMA core;",
    ],
    [
      "MODULE_MIGRATION_OPERATION_FORBIDDEN",
      "GRANT SELECT ON mod_starter.sample TO homi_app;",
    ],
    [
      "MODULE_MIGRATION_OPERATION_FORBIDDEN",
      "BEGIN; CREATE TABLE mod_starter.sample2 (id uuid); COMMIT;",
    ],
    [
      "MODULE_MIGRATION_OPERATION_FORBIDDEN",
      "SELECT set_config('search_path', 'core', false);",
    ],
    [
      "MODULE_MIGRATION_OPERATION_FORBIDDEN",
      "CREATE SCHEMA anything;",
    ],
  ];

  for (const [code, sql] of invalidMigrations) {
    assert.throws(
      () =>
        validateModuleMigrationSql(
          sql,
          "mod_starter",
          "0001_invalid.sql",
        ),
      (error) => errorCode(error, code),
    );
  }

  assert.equal(
    compareHomiModuleVersions("1.0.0", "1.0.0"),
    0,
  );
  assert.equal(
    compareHomiModuleVersions("1.0.1", "1.0.0"),
    1,
  );
  assert.equal(
    compareHomiModuleVersions("2.0.0", "10.0.0"),
    -1,
  );
  assert.equal(
    compareHomiModuleVersions(
      "1.0.0-alpha-beta.1",
      "1.0.0-alpha-beta.2",
    ),
    -1,
  );
  assert.equal(
    compareHomiModuleVersions(
      "1.0.0-alpha.2",
      "1.0.0",
    ),
    -1,
  );

  const base = Object.freeze({
    moduleId: "00000000-0000-4000-8000-000000000002",
    publisher: "Homi",
    state: "installed",
    currentVersion: "1.0.0",
    activeVersion: "1.0.0",
    targetDigest: null,
    targetMigrationState: null,
  });

  assert.deepEqual(
    planHomiModuleInstall(null, {
      publisher: "Homi",
      version: "1.0.0",
      packageDigest: "sha256:fresh",
    }),
    {
      kind: "fresh-install",
      fromVersion: null,
    },
  );

  assert.deepEqual(
    planHomiModuleInstall(base, {
      publisher: "Homi",
      version: "2.0.0",
      packageDigest: "sha256:update",
    }),
    {
      kind: "update",
      fromVersion: "1.0.0",
    },
  );

  assert.deepEqual(
    planHomiModuleInstall(
      {
        ...base,
        targetDigest: "sha256:same",
        targetMigrationState: "failed",
      },
      {
        publisher: "Homi",
        version: "2.0.0",
        packageDigest: "sha256:same",
      },
    ),
    {
      kind: "retry",
      fromVersion: "1.0.0",
    },
  );

  assert.deepEqual(
    planHomiModuleInstall(
      {
        ...base,
        currentVersion: "1.0.0",
        targetDigest: "sha256:active",
        targetMigrationState: "applied",
      },
      {
        publisher: "Homi",
        version: "1.0.0",
        packageDigest: "sha256:active",
      },
    ),
    {
      kind: "already-installed",
      fromVersion: "1.0.0",
    },
  );

  assert.throws(
    () =>
      planHomiModuleInstall(base, {
        publisher: "Other Publisher",
        version: "2.0.0",
        packageDigest: "sha256:other",
      }),
    (error) =>
      errorCode(error, "MODULE_KEY_OWNERSHIP_CONFLICT"),
  );

  assert.throws(
    () =>
      planHomiModuleInstall(
        {
          ...base,
          targetDigest: "sha256:registered",
          targetMigrationState: "failed",
        },
        {
          publisher: "Homi",
          version: "2.0.0",
          packageDigest: "sha256:different",
        },
      ),
    (error) =>
      errorCode(error, "MODULE_VERSION_DIGEST_MISMATCH"),
  );

  assert.throws(
    () =>
      planHomiModuleInstall(base, {
        publisher: "Homi",
        version: "0.9.0",
        packageDigest: "sha256:old",
      }),
    (error) =>
      errorCode(
        error,
        "MODULE_VERSION_DOWNGRADE_NOT_ALLOWED",
      ),
  );

  assert.throws(
    () =>
      planHomiModuleInstall(
        {
          ...base,
          currentVersion: "2.0.0",
          activeVersion: "2.0.0",
          targetDigest: "sha256:old-rolled-back",
          targetMigrationState: "rolled_back",
        },
        {
          publisher: "Homi",
          version: "1.5.0",
          packageDigest: "sha256:old-rolled-back",
        },
      ),
    (error) =>
      errorCode(
        error,
        "MODULE_VERSION_DOWNGRADE_NOT_ALLOWED",
      ),
  );

  const runtimeArtifact =
    await installPreparedModuleArtifact(
      prepared,
      runtimeRoot,
    );
  const serverEntrypoint =
    prepared.manifest.entrypoints.server;
  assert.ok(serverEntrypoint);
  const imported = await import(
    pathToFileURL(
      join(
        runtimeArtifact,
        serverEntrypoint.slice(2),
      ),
    ).href
  );
  assert.equal(
    typeof imported.createHomiServerModule,
    "function",
  );
  const runtimeModule = imported.createHomiServerModule({
    moduleDatabase: {
      async query() {
        throw new Error("not used by package runtime-resolution proof");
      },
      async transaction() {
        throw new Error("not used by package runtime-resolution proof");
      },
    },
    async resolveContext() {
      throw new Error("not used by package runtime-resolution proof");
    },
    async requireEnabled() {
      throw new Error("not used by package runtime-resolution proof");
    },
  });
  assert.equal(runtimeModule.moduleKey, "starter");
  assert.equal(runtimeModule.moduleApiVersion, 1);
  assert.equal(runtimeModule.sync?.mutationHandlers.length, 1);
  assert.equal(
    runtimeModule.sync?.mutationHandlers[0]?.entityType,
    "item",
  );

  console.log(
    "PASS_54_MODULE_PACKAGE_MIGRATION_INSTALL_PLAN",
  );
  console.log(
    "PASS_54_MANAGED_SERVER_ARTIFACT_RUNTIME_RESOLUTION",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
  await rm(runtimeRoot, { recursive: true, force: true });
}
