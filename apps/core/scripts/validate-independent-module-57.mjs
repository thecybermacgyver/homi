import assert from "node:assert/strict";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { Client } from "pg";
import { createHomiDatabase } from "@homi/db";
import {
  HomiModuleInstallError,
  installHomiModule,
  recoverFailedHomiModuleUpdate,
} from "../dist/module-installer.js";
import { loadHomiServerModules } from "../dist/module-host.js";
import {
  createHomiHouseholdModuleService,
} from "../dist/household-modules.js";
import {
  createHomiModuleSyncService,
} from "../dist/module-sync.js";

const migratorUrl = process.env.HOMI_TEST_MIGRATOR_DATABASE_URL;
const appUrl = process.env.HOMI_TEST_APP_DATABASE_URL;

if (!migratorUrl || !appUrl) {
  throw new Error(
    "HOMI_TEST_MIGRATOR_DATABASE_URL and HOMI_TEST_APP_DATABASE_URL are required.",
  );
}

const USER_ID = "11111111-1111-4111-8111-111111111111";
const HOUSEHOLD_A = "22222222-2222-4222-8222-222222222222";
const HOUSEHOLD_B = "23232323-2323-4232-8232-232323232323";
const MEMBERSHIP_A = "33333333-3333-4333-8333-333333333333";
const MEMBERSHIP_B = "34343434-3434-4434-8434-343434343434";
const PERSON_A = "44444444-4444-4444-8444-444444444444";
const PERSON_B = "45454545-4545-4454-8454-454545454545";
const CLIENT_ID = "55555555-5555-4555-8555-555555555555";
const CLIENT_INSTANCE_ID =
  "66666666-6666-4666-8666-666666666666";
const ITEM_ID = "77777777-7777-4777-8777-777777777777";
const CREATE_MUTATION_ID =
  "88888888-8888-4888-8888-888888888888";
const DISABLED_MUTATION_ID =
  "99999999-9999-4999-8999-999999999999";

const templateDirectory = fileURLToPath(
  new URL(
    "../../../templates/homi-module-template/",
    import.meta.url,
  ),
);

const temp = await mkdtemp(
  join(tmpdir(), "homi-independent-module-57-"),
);
const coreRoot = fileURLToPath(
  new URL("../", import.meta.url),
);
const installRoot = await mkdtemp(
  join(coreRoot, ".homi-modules-acceptance57-"),
);
const v01 = join(temp, "starter-0.1.0");
const v02 = join(temp, "starter-0.2.0");
const v03 = join(temp, "starter-0.3.0");

function context(
  householdId,
  membershipId,
  householdPersonId,
  requestId,
) {
  return Object.freeze({
    requestId,
    userId: USER_ID,
    householdId,
    membershipId,
    householdPersonId,
    clientId: CLIENT_ID,
    locale: "en-CA",
    timeZone: "America/Toronto",
  });
}

const contextA = context(
  HOUSEHOLD_A,
  MEMBERSHIP_A,
  PERSON_A,
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const contextB = context(
  HOUSEHOLD_B,
  MEMBERSHIP_B,
  PERSON_B,
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

async function setPackageVersion(
  directory,
  version,
) {
  const packagePath = join(directory, "package.json");
  const packageJson = JSON.parse(
    await readFile(packagePath, "utf8"),
  );
  packageJson.version = version;
  await writeFile(
    packagePath,
    JSON.stringify(packageJson, null, 2) + "\n",
  );

  const manifestPath = join(directory, "homi.module.json");
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  );
  manifest.version = version;
  await writeFile(
    manifestPath,
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

async function queryAsOwner(sql, params = []) {
  const client = new Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    await client.query("SET ROLE homi_owner");
    return await client.query(sql, params);
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    await client.end();
  }
}

async function registryState() {
  const result = await queryAsOwner(
    `SELECT
       m.state,
       m.current_version AS "currentVersion",
       mv.version,
       mv.migration_state AS "migrationState",
       mv.retired_at IS NOT NULL AS retired
     FROM core.modules AS m
     JOIN core.module_versions AS mv
       ON mv.module_id = m.id
     WHERE m.module_key = 'starter'
     ORDER BY mv.version`,
  );
  return result.rows;
}

await cp(templateDirectory, v01, { recursive: true });
await cp(templateDirectory, v02, { recursive: true });
await cp(templateDirectory, v03, { recursive: true });

await setPackageVersion(v02, "0.2.0");
await writeFile(
  join(v02, "migrations", "0001_acceptance_update.sql"),
  `CREATE TABLE mod_starter.acceptance_update_marker (
  id uuid PRIMARY KEY,
  note text NOT NULL
);
`,
);

await setPackageVersion(v03, "0.3.0");
await writeFile(
  join(v03, "migrations", "0001_acceptance_update.sql"),
  `CREATE TABLE mod_starter.acceptance_update_marker (
  id uuid PRIMARY KEY,
  note text NOT NULL
);
`,
);
await writeFile(
  join(v03, "migrations", "0002_acceptance_failure.sql"),
  `CREATE TABLE mod_starter.items (
  id uuid PRIMARY KEY
);
`,
);

try {
  const installed = await installHomiModule({
    packageDirectory: v01,
    installRoot,
    databaseUrl: migratorUrl,
  });
  assert.equal(installed.status, "installed");
  assert.equal(installed.moduleKey, "starter");
  assert.equal(installed.version, "0.1.0");
  assert.deepEqual(
    installed.appliedMigrations,
    ["0000_starter_initial.sql"],
  );

  await queryAsOwner(
    `INSERT INTO core.users (
       id, auth_subject, display_name, preferred_locale, time_zone
     )
     VALUES (
       $1::uuid, 'acceptance-user', 'Acceptance User',
       'en-CA', 'America/Toronto'
     )`,
    [USER_ID],
  );
  await queryAsOwner(
    `INSERT INTO core.households (
       id, name, default_locale, time_zone, created_by_user_id
     )
     VALUES
       ($1::uuid, 'Acceptance A', 'en-CA', 'America/Toronto', $3::uuid),
       ($2::uuid, 'Acceptance B', 'en-CA', 'America/Toronto', $3::uuid)`,
    [HOUSEHOLD_A, HOUSEHOLD_B, USER_ID],
  );
  await queryAsOwner(
    `INSERT INTO core.household_memberships (
       id, household_id, user_id, status
     )
     VALUES
       ($1::uuid, $3::uuid, $5::uuid, 'active'),
       ($2::uuid, $4::uuid, $5::uuid, 'active')`,
    [
      MEMBERSHIP_A,
      MEMBERSHIP_B,
      HOUSEHOLD_A,
      HOUSEHOLD_B,
      USER_ID,
    ],
  );
  await queryAsOwner(
    `INSERT INTO core.household_people (
       id, household_id, linked_membership_id,
       display_name, status
     )
     VALUES
       ($1::uuid, $3::uuid, $5::uuid, 'Acceptance A', 'active'),
       ($2::uuid, $4::uuid, $6::uuid, 'Acceptance B', 'active')`,
    [
      PERSON_A,
      PERSON_B,
      HOUSEHOLD_A,
      HOUSEHOLD_B,
      MEMBERSHIP_A,
      MEMBERSHIP_B,
    ],
  );
  await queryAsOwner(
    `INSERT INTO core.clients (
       id, user_id, client_instance_id, label, platform, app_version
     )
     VALUES (
       $1::uuid, $2::uuid, $3::uuid,
       'Acceptance Client', 'test', '5.7'
     )`,
    [CLIENT_ID, USER_ID, CLIENT_INSTANCE_ID],
  );

  const database = createHomiDatabase(appUrl);
  const requestContext = Object.freeze({
    async resolve(input) {
      const requested =
        String(
          input.headers?.["x-homi-household-id"] ??
            input.headers?.["X-Homi-Household-ID"] ??
            "",
        );
      const selected =
        requested === HOUSEHOLD_B ? contextB : contextA;
      return Object.freeze({
        ...selected,
        requestId:
          input.requestId ?? selected.requestId,
        ...(input.clientId
          ? { clientId: input.clientId }
          : {}),
      });
    },
  });

  try {
    const modules = await loadHomiServerModules({
      installRoot,
      database: database.db,
      requestContext,
    });
    assert.equal(modules.length, 1);
    assert.equal(modules[0]?.moduleKey, "starter");

    const lifecycle = createHomiHouseholdModuleService(
      database.db,
      modules,
    );
    const sync = createHomiModuleSyncService(
      database.db,
      modules,
    );

    const initialA = (
      await lifecycle.list(contextA)
    ).find((item) => item.moduleKey === "starter");
    const initialB = (
      await lifecycle.list(contextB)
    ).find((item) => item.moduleKey === "starter");
    assert(initialA && initialB);
    assert.equal(initialA.enabled, false);
    assert.equal(initialB.enabled, false);

    const enabledA = await lifecycle.setEnabled(
      contextA,
      "starter",
      { enabled: true, baseRevision: 0n },
    );
    assert.equal(enabledA.enabled, true);
    assert.equal(enabledA.revision, 1n);

    const stillDisabledB = (
      await lifecycle.list(contextB)
    ).find((item) => item.moduleKey === "starter");
    assert(stillDisabledB);
    assert.equal(stillDisabledB.enabled, false);
    assert.equal(stillDisabledB.revision, 0n);

    const moduleApp = Fastify({ logger: false });
    for (const module of modules) {
      await module.register(moduleApp);
    }
    await moduleApp.ready();

    const headersA = {
      "x-homi-household-id": HOUSEHOLD_A,
      "x-homi-client-id": CLIENT_ID,
    };

    const setupSaved = await moduleApp.inject({
      method: "PUT",
      url: "/api/v1/modules/starter/setup",
      headers: headersA,
      payload: { boardLabel: "Acceptance Board" },
    });
    assert.equal(setupSaved.statusCode, 200);
    assert.equal(
      setupSaved.json().data.boardLabel,
      "Acceptance Board",
    );

    const created = await sync.applyMutation(
      contextA,
      {
        clientMutationId: CREATE_MUTATION_ID,
        moduleKey: "starter",
        entityType: "item",
        entityId: ITEM_ID,
        operation: "create",
        baseRevision: 0n,
        payload: { title: "Preserved acceptance item" },
      },
    );
    assert.equal(created.status, "applied");
    assert.equal(created.serverRevision, "1");

    const disabledA = await lifecycle.setEnabled(
      contextA,
      "starter",
      { enabled: false, baseRevision: 1n },
    );
    assert.equal(disabledA.enabled, false);
    assert.equal(disabledA.revision, 2n);

    const rejected = await sync.applyMutation(
      contextA,
      {
        clientMutationId: DISABLED_MUTATION_ID,
        moduleKey: "starter",
        entityType: "item",
        entityId:
          "12121212-1212-4121-8121-121212121212",
        operation: "create",
        baseRevision: 0n,
        payload: { title: "Must stay disabled" },
      },
    );
    assert.equal(rejected.status, "rejected");
    assert.equal(
      rejected.errorCode,
      "MODULE_NOT_ENABLED",
    );

    const preservedWhileDisabled =
      await database.db.execute(
        `SELECT count(*)::int AS count
         FROM mod_starter.items
         WHERE household_id = '${HOUSEHOLD_A}'::uuid
           AND id = '${ITEM_ID}'::uuid
           AND deleted_at IS NULL`,
      );
    assert.equal(
      Number(
        preservedWhileDisabled.rows[0]?.count ?? -1,
      ),
      1,
    );

    const reenabledA = await lifecycle.setEnabled(
      contextA,
      "starter",
      { enabled: true, baseRevision: 2n },
    );
    assert.equal(reenabledA.enabled, true);
    assert.equal(reenabledA.revision, 3n);
    assert.equal(
      reenabledA.setupState,
      "configured",
    );

    const setupAfterReenable = await moduleApp.inject({
      method: "GET",
      url: "/api/v1/modules/starter/setup",
      headers: headersA,
    });
    assert.equal(setupAfterReenable.statusCode, 200);
    assert.equal(
      setupAfterReenable.json().data.boardLabel,
      "Acceptance Board",
    );

    const itemAfterReenable = await moduleApp.inject({
      method: "GET",
      url: `/api/v1/modules/starter/items/${ITEM_ID}`,
      headers: headersA,
    });
    assert.equal(itemAfterReenable.statusCode, 200);
    assert.equal(
      itemAfterReenable.json().data.title,
      "Preserved acceptance item",
    );

    await moduleApp.close();
  } finally {
    await database.close();
  }

  const updated = await installHomiModule({
    packageDirectory: v02,
    installRoot,
    databaseUrl: migratorUrl,
  });
  assert.equal(updated.status, "installed");
  assert.equal(updated.version, "0.2.0");
  assert.equal(updated.fromVersion, "0.1.0");
  assert.deepEqual(
    updated.appliedMigrations,
    ["0001_acceptance_update.sql"],
  );

  let state = await registryState();
  assert.deepEqual(
    state.map((row) => ({
      version: row.version,
      migrationState: row.migrationState,
      retired: row.retired,
    })),
    [
      {
        version: "0.1.0",
        migrationState: "applied",
        retired: true,
      },
      {
        version: "0.2.0",
        migrationState: "applied",
        retired: false,
      },
    ],
  );
  assert.equal(state[0]?.state, "installed");
  assert.equal(state[0]?.currentVersion, "0.2.0");

  await assert.rejects(
    () =>
      installHomiModule({
        packageDirectory: v03,
        installRoot,
        databaseUrl: migratorUrl,
      }),
    (error) =>
      error instanceof HomiModuleInstallError &&
      error.code === "MODULE_INSTALL_FAILED",
  );

  state = await registryState();
  const failed = state.find(
    (row) => row.version === "0.3.0",
  );
  const activeAfterFailure = state.find(
    (row) => row.version === "0.2.0",
  );
  assert(failed && activeAfterFailure);
  assert.equal(failed.migrationState, "failed");
  assert.equal(failed.retired, true);
  assert.equal(activeAfterFailure.retired, false);
  assert.equal(failed.currentVersion, "0.2.0");
  assert.equal(failed.state, "installed");

  const preservedImmediatelyAfterFailure = await queryAsOwner(
    `SELECT
       i.title,
       s.board_label AS "boardLabel"
     FROM mod_starter.items AS i
     JOIN mod_starter.household_settings AS s
       ON s.household_id = i.household_id
     WHERE i.household_id = $1::uuid
       AND i.id = $2::uuid
       AND i.deleted_at IS NULL`,
    [HOUSEHOLD_A, ITEM_ID],
  );
  assert.deepEqual(preservedImmediatelyAfterFailure.rows, [
    {
      title: "Preserved acceptance item",
      boardLabel: "Acceptance Board",
    },
  ]);

  const migrationLedger = await queryAsOwner(
    `SELECT id, module_version AS "moduleVersion"
     FROM mod_starter.schema_migrations
     ORDER BY id`,
  );
  assert.deepEqual(migrationLedger.rows, [
    {
      id: "0000_starter_initial.sql",
      moduleVersion: "0.1.0",
    },
    {
      id: "0001_acceptance_update.sql",
      moduleVersion: "0.2.0",
    },
  ]);

  const recovered =
    await recoverFailedHomiModuleUpdate({
      moduleKey: "starter",
      targetVersion: "0.3.0",
      databaseUrl: migratorUrl,
    });
  assert.equal(recovered.restoredVersion, "0.2.0");

  state = await registryState();
  const rolledBack = state.find(
    (row) => row.version === "0.3.0",
  );
  const restored = state.find(
    (row) => row.version === "0.2.0",
  );
  assert(rolledBack && restored);
  assert.equal(
    rolledBack.migrationState,
    "rolled_back",
  );
  assert.equal(rolledBack.retired, true);
  assert.equal(restored.retired, false);
  assert.equal(rolledBack.currentVersion, "0.2.0");

  const preserved = await queryAsOwner(
    `SELECT
       i.title,
       s.board_label AS "boardLabel"
     FROM mod_starter.items AS i
     JOIN mod_starter.household_settings AS s
       ON s.household_id = i.household_id
     WHERE i.household_id = $1::uuid
       AND i.id = $2::uuid
       AND i.deleted_at IS NULL`,
    [HOUSEHOLD_A, ITEM_ID],
  );
  assert.deepEqual(preserved.rows, [
    {
      title: "Preserved acceptance item",
      boardLabel: "Acceptance Board",
    },
  ]);

  const householdStates = await queryAsOwner(
    `SELECT
       household_id::text AS "householdId",
       enabled,
       revision::text AS revision
     FROM core.household_modules
     WHERE module_id = (
       SELECT id FROM core.modules
       WHERE module_key = 'starter'
     )
     ORDER BY household_id`,
  );
  assert.deepEqual(householdStates.rows, [
    {
      householdId: HOUSEHOLD_A,
      enabled: true,
      revision: "3",
    },
  ]);

  const updateRuns = await queryAsOwner(
    `SELECT
       from_version AS "fromVersion",
       to_version AS "toVersion",
       status
     FROM core.update_runs AS ur
     JOIN core.modules AS m
       ON m.id = ur.module_id
     WHERE m.module_key = 'starter'
     ORDER BY ur.started_at, ur.id`,
  );
  assert.deepEqual(
    updateRuns.rows.map((row) => row.status),
    ["complete", "complete", "rolled_back"],
  );

  console.log(
    "PASS_57_INDEPENDENT_MODULE_ACCEPTANCE " +
      "household-isolation=yes " +
      "disable-reenable-preserves-data=yes " +
      "compatible-update=yes " +
      "failed-update-rollback=yes",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
  await rm(installRoot, { recursive: true, force: true });
}
