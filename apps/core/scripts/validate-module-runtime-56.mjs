import assert from "node:assert/strict";
import Fastify from "fastify";
import { Client } from "pg";
import { createHomiDatabase } from "@homi/db";
import { loadHomiServerModules } from "../dist/module-host.js";
import {
  createHomiHouseholdModuleService,
} from "../dist/household-modules.js";
import {
  createHomiModuleSyncService,
  HomiModuleSyncError,
} from "../dist/module-sync.js";

const migratorUrl = process.env.HOMI_TEST_MIGRATOR_DATABASE_URL;
const appUrl = process.env.HOMI_TEST_APP_DATABASE_URL;
const installRoot = process.env.HOMI_TEST_MODULES_DIRECTORY;

if (!migratorUrl || !appUrl || !installRoot) {
  throw new Error(
    "HOMI_TEST_MIGRATOR_DATABASE_URL, HOMI_TEST_APP_DATABASE_URL and HOMI_TEST_MODULES_DIRECTORY are required.",
  );
}

const USER_ID = "11111111-1111-4111-8111-111111111111";
const HOUSEHOLD_ID = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333";
const PERSON_ID = "44444444-4444-4444-8444-444444444444";
const CLIENT_ID = "55555555-5555-4555-8555-555555555555";
const CLIENT_INSTANCE_ID =
  "66666666-6666-4666-8666-666666666666";
const REQUEST_ID = "77777777-7777-4777-8777-777777777777";
const ITEM_ID = "88888888-8888-4888-8888-888888888888";
const CREATE_MUTATION_ID =
  "99999999-9999-4999-8999-999999999999";
const UPDATE_MUTATION_ID =
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STALE_MUTATION_ID =
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DELETE_MUTATION_ID =
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DISABLED_MUTATION_ID =
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const context = Object.freeze({
  requestId: REQUEST_ID,
  userId: USER_ID,
  householdId: HOUSEHOLD_ID,
  membershipId: MEMBERSHIP_ID,
  householdPersonId: PERSON_ID,
  clientId: CLIENT_ID,
  locale: "en-CA",
  timeZone: "America/Toronto",
});

const migrator = new Client({ connectionString: migratorUrl });
await migrator.connect();

try {
  await migrator.query("SET ROLE homi_owner");
  await migrator.query(
    `INSERT INTO core.users (
       id, auth_subject, display_name, preferred_locale, time_zone
     )
     VALUES ($1::uuid, 'test-auth-subject', 'Test User', 'en-CA', 'America/Toronto')`,
    [USER_ID],
  );
  await migrator.query(
    `INSERT INTO core.households (
       id, name, default_locale, time_zone, created_by_user_id
     )
     VALUES ($1::uuid, 'Test Home', 'en-CA', 'America/Toronto', $2::uuid)`,
    [HOUSEHOLD_ID, USER_ID],
  );
  await migrator.query(
    `INSERT INTO core.household_memberships (
       id, household_id, user_id, status
     )
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'active')`,
    [MEMBERSHIP_ID, HOUSEHOLD_ID, USER_ID],
  );
  await migrator.query(
    `INSERT INTO core.household_people (
       id, household_id, linked_membership_id, display_name, status
     )
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'Test User', 'active')`,
    [PERSON_ID, HOUSEHOLD_ID, MEMBERSHIP_ID],
  );
  await migrator.query(
    `INSERT INTO core.clients (
       id, user_id, client_instance_id, label, platform, app_version
     )
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'Test Client', 'test', '5.6')`,
    [CLIENT_ID, USER_ID, CLIENT_INSTANCE_ID],
  );
  await migrator.query("RESET ROLE");
} finally {
  await migrator.end();
}

const database = createHomiDatabase(appUrl);
const requestContext = Object.freeze({
  async resolve(input) {
    return Object.freeze({
      ...context,
      requestId: input.requestId ?? REQUEST_ID,
      ...(input.clientId ? { clientId: input.clientId } : {}),
    });
  },
});

const modules = await loadHomiServerModules({
  installRoot,
  database: database.db,
  requestContext,
});

assert.equal(modules.length, 1);
const starterRuntime = modules[0];
assert.equal(starterRuntime?.moduleKey, "starter");
assert.equal(starterRuntime?.moduleApiVersion, 1);
assert.equal(starterRuntime?.mutationHandlers?.length, 1);

const lifecycle = createHomiHouseholdModuleService(
  database.db,
  modules,
);
const sync = createHomiModuleSyncService(database.db, modules);

function starterFrom(list) {
  const found = list.find((item) => item.moduleKey === "starter");
  assert.ok(found);
  return found;
}

const initial = starterFrom(await lifecycle.list(context));
assert.equal(initial.enabled, false);
assert.equal(initial.revision, 0n);
assert.equal(initial.setupRequired, true);
assert.equal(initial.setupState, "unconfigured");

const enabled = await lifecycle.setEnabled(
  context,
  "starter",
  { enabled: true, baseRevision: 0n },
);
assert.equal(enabled.enabled, true);
assert.equal(enabled.revision, 1n);
assert.equal(enabled.setupState, "unconfigured");

const moduleApp = Fastify({ logger: false });
for (const module of modules) {
  await module.register(moduleApp);
}
await moduleApp.ready();

const headers = {
  "x-homi-household-id": HOUSEHOLD_ID,
  "x-homi-client-id": CLIENT_ID,
};

const setupBefore = await moduleApp.inject({
  method: "GET",
  url: "/api/v1/modules/starter/setup",
  headers,
});
assert.equal(setupBefore.statusCode, 200);
assert.deepEqual(setupBefore.json(), { data: null });

const setupSaved = await moduleApp.inject({
  method: "PUT",
  url: "/api/v1/modules/starter/setup",
  headers,
  payload: { boardLabel: "Family Notes" },
});
assert.equal(setupSaved.statusCode, 200);
assert.equal(setupSaved.json().data.boardLabel, "Family Notes");
assert.equal(setupSaved.json().data.revision, "1");

const configured = starterFrom(await lifecycle.list(context));
assert.equal(configured.setupState, "configured");

const createInput = {
  clientMutationId: CREATE_MUTATION_ID,
  moduleKey: "starter",
  entityType: "item",
  entityId: ITEM_ID,
  operation: "create",
  baseRevision: 0n,
  payload: { title: "Proof item" },
};

const created = await sync.applyMutation(context, createInput);
assert.equal(created.status, "applied");
assert.equal(created.serverRevision, "1");
assert.equal(created.replayed, false);
assert.ok(created.changeSequence);

const replayed = await sync.applyMutation(context, createInput);
assert.equal(replayed.status, "applied");
assert.equal(replayed.serverRevision, "1");
assert.equal(replayed.changeSequence, created.changeSequence);
assert.equal(replayed.replayed, true);

await assert.rejects(
  () =>
    sync.applyMutation(context, {
      ...createInput,
      payload: { title: "Different request" },
    }),
  (error) =>
    error instanceof HomiModuleSyncError &&
    error.code === "MUTATION_ID_REUSED" &&
    error.statusCode === 409,
);

const itemAfterCreate = await moduleApp.inject({
  method: "GET",
  url: `/api/v1/modules/starter/items/${ITEM_ID}`,
  headers,
});
assert.equal(itemAfterCreate.statusCode, 200);
assert.equal(itemAfterCreate.json().data.title, "Proof item");
assert.equal(itemAfterCreate.json().data.revision, "1");

const updated = await sync.applyMutation(context, {
  clientMutationId: UPDATE_MUTATION_ID,
  moduleKey: "starter",
  entityType: "item",
  entityId: ITEM_ID,
  operation: "update",
  baseRevision: 1n,
  payload: { title: "Proof item updated" },
});
assert.equal(updated.status, "applied");
assert.equal(updated.serverRevision, "2");

const stale = await sync.applyMutation(context, {
  clientMutationId: STALE_MUTATION_ID,
  moduleKey: "starter",
  entityType: "item",
  entityId: ITEM_ID,
  operation: "update",
  baseRevision: 1n,
  payload: { title: "Stale update" },
});
assert.equal(stale.status, "conflict");
assert.equal(stale.serverRevision, "2");
assert.equal(stale.errorCode, "REVISION_CONFLICT");
assert.equal(stale.serverState.title, "Proof item updated");

const deleted = await sync.applyMutation(context, {
  clientMutationId: DELETE_MUTATION_ID,
  moduleKey: "starter",
  entityType: "item",
  entityId: ITEM_ID,
  operation: "delete",
  baseRevision: 2n,
  payload: {},
});
assert.equal(deleted.status, "applied");
assert.equal(deleted.serverRevision, "3");

const itemAfterDelete = await moduleApp.inject({
  method: "GET",
  url: `/api/v1/modules/starter/items/${ITEM_ID}`,
  headers,
});
assert.equal(itemAfterDelete.statusCode, 404);

const disabled = await lifecycle.setEnabled(
  context,
  "starter",
  { enabled: false, baseRevision: 1n },
);
assert.equal(disabled.enabled, false);
assert.equal(disabled.revision, 2n);

const rejectedWhileDisabled = await sync.applyMutation(context, {
  clientMutationId: DISABLED_MUTATION_ID,
  moduleKey: "starter",
  entityType: "item",
  entityId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  operation: "create",
  baseRevision: 0n,
  payload: { title: "Must not be created" },
});
assert.equal(rejectedWhileDisabled.status, "rejected");
assert.equal(
  rejectedWhileDisabled.errorCode,
  "MODULE_NOT_ENABLED",
);

const reenabled = await lifecycle.setEnabled(
  context,
  "starter",
  { enabled: true, baseRevision: 2n },
);
assert.equal(reenabled.enabled, true);
assert.equal(reenabled.revision, 3n);
assert.equal(reenabled.setupState, "configured");

const verifier = new Client({ connectionString: appUrl });
await verifier.connect();
try {
  const itemRows = await verifier.query(
    `SELECT title, revision::text AS revision, deleted_at IS NOT NULL AS deleted
     FROM mod_starter.items
     WHERE household_id = $1::uuid AND id = $2::uuid`,
    [HOUSEHOLD_ID, ITEM_ID],
  );
  assert.deepEqual(itemRows.rows, [
    {
      title: "Proof item updated",
      revision: "3",
      deleted: true,
    },
  ]);

  const setupRows = await verifier.query(
    `SELECT board_label AS "boardLabel", revision::text AS revision
     FROM mod_starter.household_settings
     WHERE household_id = $1::uuid`,
    [HOUSEHOLD_ID],
  );
  assert.deepEqual(setupRows.rows, [
    { boardLabel: "Family Notes", revision: "1" },
  ]);

  const changes = await verifier.query(
    `SELECT operation, revision::text AS revision
     FROM core.change_log
     WHERE household_id = $1::uuid
       AND module_key = 'starter'
       AND entity_type = 'item'
     ORDER BY sequence`,
    [HOUSEHOLD_ID],
  );
  assert.deepEqual(changes.rows, [
    { operation: "create", revision: "1" },
    { operation: "update", revision: "2" },
    { operation: "delete", revision: "3" },
  ]);

  const audit = await verifier.query(
    `SELECT count(*)::int AS count
     FROM core.audit_log
     WHERE household_id = $1::uuid
       AND source_module_key = 'starter'
       AND target_type = 'item'`,
    [HOUSEHOLD_ID],
  );
  assert.equal(audit.rows[0]?.count, 3);

  const outbox = await verifier.query(
    `SELECT count(*)::int AS count
     FROM core.event_outbox
     WHERE household_id = $1::uuid
       AND source_module_key = 'starter'
       AND aggregate_type = 'item'`,
    [HOUSEHOLD_ID],
  );
  assert.equal(outbox.rows[0]?.count, 3);

  const mutationRows = await verifier.query(
    `SELECT status, count(*)::int AS count
     FROM core.sync_mutations
     WHERE household_id = $1::uuid
       AND module_key = 'starter'
     GROUP BY status
     ORDER BY status`,
    [HOUSEHOLD_ID],
  );
  assert.deepEqual(mutationRows.rows, [
    { status: "applied", count: 3 },
    { status: "conflict", count: 1 },
    { status: "rejected", count: 1 },
  ]);
} finally {
  await verifier.end();
}

await moduleApp.close();
await database.close();

console.log(
  "PASS_56_REAL_POSTGRES_MANAGED_MODULE_RUNTIME_SETUP_SYNC_LIFECYCLE",
);
