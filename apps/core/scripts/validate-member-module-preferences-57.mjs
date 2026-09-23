import assert from "node:assert/strict";
import fs from "node:fs";
import { Client } from "pg";
import { createHomiDatabase } from "@homi/db";
import { parseHomiModuleManifest } from "@homi/module-sdk";
import {
  createHomiHouseholdModuleService,
} from "../dist/household-modules.js";
import {
  createHomiMemberModulePreferenceService,
  HomiMemberModulePreferenceError,
} from "../dist/member-module-preferences.js";
import {
  createHomiSyncService,
} from "../dist/sync.js";

const migratorUrl = process.env.HOMI_TEST_MIGRATOR_DATABASE_URL;
const appUrl = process.env.HOMI_TEST_APP_DATABASE_URL;
if (!migratorUrl || !appUrl) {
  throw new Error(
    "HOMI_TEST_MIGRATOR_DATABASE_URL and HOMI_TEST_APP_DATABASE_URL are required.",
  );
}
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "12121212-1212-4212-8212-121212121212";
const HOUSE = "22222222-2222-4222-8222-222222222222";
const MEMBER_A = "33333333-3333-4333-8333-333333333333";
const MEMBER_B = "34343434-3434-4434-8434-343434343434";
const PERSON_A = "44444444-4444-4444-8444-444444444444";
const PERSON_B = "45454545-4545-4545-8545-454545454545";
const CLIENT_A = "55555555-5555-4555-8555-555555555555";
const CLIENT_B = "56565656-5656-4656-8656-565656565656";
const MODULE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MODULE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MUTATION_A = "77777777-7777-4777-8777-777777777777";
const MUTATION_B = "78787878-7878-4878-8878-787878787878";
const MUTATION_CONFLICT = "79797979-7979-4979-8979-797979797979";

function context(userId, membershipId, personId, clientId) {
  return Object.freeze({
    requestId: crypto.randomUUID(),
    userId,
    householdId: HOUSE,
    membershipId,
    householdPersonId: personId,
    clientId,
    locale: "en-CA",
    timeZone: "America/Toronto",
  });
}
const contextA = context(USER_A, MEMBER_A, PERSON_A, CLIENT_A);
const contextB = context(USER_B, MEMBER_B, PERSON_B, CLIENT_B);

const template = JSON.parse(
  fs.readFileSync(
    new URL("../../../templates/homi-module-template/homi.module.json", import.meta.url),
    "utf8",
  ),
);

function manifest(moduleKey, name, schemaName) {
  const value = {
    ...structuredClone(template),
    moduleKey,
    name,
    database: {
      ...template.database,
      schema: schemaName,
    },
    navigation: template.navigation.map((item) => ({
      ...item,
      id: moduleKey,
      label: name,
      path: `/modules/${moduleKey}`,
    })),
  };
  parseHomiModuleManifest(value);
  return value;
}
const owner = new Client({ connectionString: migratorUrl });
await owner.connect();
try {
  await owner.query("SET ROLE homi_owner");
  await owner.query(
    `INSERT INTO core.users
      (id,auth_subject,display_name,status,revision)
     VALUES
      ($1::uuid,'user-a','User A','active',1),
      ($2::uuid,'user-b','User B','active',1)`,
    [USER_A, USER_B],
  );
  await owner.query(
    `INSERT INTO core.households
      (id,name,default_locale,time_zone,status,created_by_user_id,revision)
     VALUES
      ($1::uuid,'Proof Household','en-CA','America/Toronto','active',$2::uuid,1)`,
    [HOUSE, USER_A],
  );
  await owner.query(
    `INSERT INTO core.household_memberships
      (id,household_id,user_id,status,revision)
     VALUES
      ($1::uuid,$3::uuid,$4::uuid,'active',1),
      ($2::uuid,$3::uuid,$5::uuid,'active',1)`,
    [MEMBER_A, MEMBER_B, HOUSE, USER_A, USER_B],
  );
  await owner.query(
    `INSERT INTO core.household_people
      (id,household_id,linked_membership_id,display_name,status,revision)
     VALUES
      ($1::uuid,$3::uuid,$4::uuid,'User A','active',1),
      ($2::uuid,$3::uuid,$5::uuid,'User B','active',1)`,
    [PERSON_A, PERSON_B, HOUSE, MEMBER_A, MEMBER_B],
  );
  await owner.query(
    `INSERT INTO core.clients
      (id,user_id,client_instance_id,label,platform)
     VALUES
      ($1::uuid,$3::uuid,'61616161-6161-4161-8161-616161616161','A','test'),
      ($2::uuid,$4::uuid,'62626262-6262-4262-8262-626262626262','B','test')`,
    [CLIENT_A, CLIENT_B, USER_A, USER_B],
  );

  const first = manifest("starter-one", "Starter One", "mod_starter_one");
  first.extensions.familyBoard.push({
    surfaceId: "starter-summary",
    label: "Quick summary",
    slot: "noticeboard",
  });
  parseHomiModuleManifest(first);
  const second = manifest("starter-two", "Starter Two", "mod_starter_two");
  await owner.query(
    `INSERT INTO core.modules
      (id,module_key,name,publisher,state,current_version,manifest)
     VALUES
      ($1::uuid,'starter-one','Starter One','Proof','installed','0.1.0',$3::jsonb),
      ($2::uuid,'starter-two','Starter Two','Proof','installed','0.1.0',$4::jsonb)`,
    [MODULE_A, MODULE_B, JSON.stringify(first), JSON.stringify(second)],
  );
  await owner.query("RESET ROLE");
} finally {
  await owner.end();
}
const database = createHomiDatabase(appUrl);
const lifecycle = createHomiHouseholdModuleService(database.db, []);
const preferences = createHomiMemberModulePreferenceService(database.db);
const sync = createHomiSyncService(database.db);

try {
  const enabledA = await lifecycle.setEnabled(
    contextA,
    "starter-one",
    { enabled: true, baseRevision: 0n },
  );
  const enabledB = await lifecycle.setEnabled(
    contextA,
    "starter-two",
    { enabled: true, baseRevision: 0n },
  );
  assert.equal(enabledA.enabled, true);
  assert.equal(enabledB.enabled, true);

  const enabledRows = await database.db.execute(
    `SELECT count(*)::int AS count
       FROM core.household_modules
       WHERE household_id = '${HOUSE}'::uuid
         AND enabled = true`,
  );
  assert.equal(Number(enabledRows.rows[0]?.count ?? -1), 2);

  const aInitial = await preferences.list(contextA);
  const bInitial = await preferences.list(contextB);
  assert.equal(aInitial.length, 3);
  assert.equal(bInitial.length, 3);
  assert.deepEqual(
    aInitial.map((item) => item.visible),
    [true, true, true],
  );
  assert.deepEqual(
    bInitial.map((item) => item.visible),
    [true, true, true],
  );
  assert.notDeepEqual(
    aInitial.map((item) => item.id),
    bInitial.map((item) => item.id),
  );
  const aOne = aInitial.find(
    (item) =>
      item.moduleKey === "starter-one" &&
      item.surfaceId === "starter-board",
  );
  const aSummary = aInitial.find(
    (item) =>
      item.moduleKey === "starter-one" &&
      item.surfaceId === "starter-summary",
  );
  const bOne = bInitial.find(
    (item) =>
      item.moduleKey === "starter-one" &&
      item.surfaceId === "starter-board",
  );
  const bSummary = bInitial.find(
    (item) =>
      item.moduleKey === "starter-one" &&
      item.surfaceId === "starter-summary",
  );
  assert(aOne && aSummary && bOne && bSummary);
  assert.equal(aOne.label, "Family notes");
  assert.equal(aSummary.label, "Quick summary");

  const firstMutation = await preferences.applyMutation(
    contextA,
    {
      clientMutationId: MUTATION_A,
      entityId: aOne.id,
      baseRevision: aOne.revision,
      payload: { visible: false, displayOrder: 1 },
    },
  );
  assert.equal(firstMutation.status, "applied");
  assert.equal(firstMutation.replayed, false);
  assert.equal(firstMutation.serverState?.visible, false);
  assert.equal(firstMutation.serverState?.displayOrder, 1);
  assert.equal(firstMutation.serverState?.revision, "2");
  assert.doesNotThrow(
    () => JSON.stringify(firstMutation),
    "applied mutation result must be HTTP JSON serializable",
  );

  const replay = await preferences.applyMutation(
    contextA,
    {
      clientMutationId: MUTATION_A,
      entityId: aOne.id,
      baseRevision: aOne.revision,
      payload: { visible: false, displayOrder: 1 },
    },
  );
  assert.equal(replay.status, "applied");
  assert.equal(replay.replayed, true);
  await assert.rejects(
    () =>
      preferences.applyMutation(
        contextA,
        {
          clientMutationId: MUTATION_A,
          entityId: aOne.id,
          baseRevision: aOne.revision,
          payload: { visible: true },
        },
      ),
    (error) =>
      error instanceof HomiMemberModulePreferenceError &&
      error.code === "MUTATION_ID_REUSED",
  );

  const secondMutation = await preferences.applyMutation(
    contextA,
    {
      clientMutationId: MUTATION_B,
      entityId: aSummary.id,
      baseRevision: aSummary.revision,
      payload: { displayOrder: 0 },
    },
  );
  assert.equal(secondMutation.status, "applied");

  const conflict = await preferences.applyMutation(
    contextA,
    {
      clientMutationId: MUTATION_CONFLICT,
      entityId: aOne.id,
      baseRevision: 1n,
      payload: { visible: true },
    },
  );
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.errorCode, "REVISION_CONFLICT");
  assert.equal(conflict.serverState?.visible, false);
  assert.equal(conflict.serverState?.revision, "2");
  assert.doesNotThrow(
    () => JSON.stringify(conflict),
    "conflict mutation result must be HTTP JSON serializable",
  );

  const aAfter = await preferences.list(contextA);
  const bAfter = await preferences.list(contextB);
  const aAfterOne = aAfter.find(
    (item) =>
      item.moduleKey === "starter-one" &&
      item.surfaceId === "starter-board",
  );
  const aAfterSummary = aAfter.find(
    (item) =>
      item.moduleKey === "starter-one" &&
      item.surfaceId === "starter-summary",
  );
  const bAfterOne = bAfter.find(
    (item) =>
      item.moduleKey === "starter-one" &&
      item.surfaceId === "starter-board",
  );
  const bAfterSummary = bAfter.find(
    (item) =>
      item.moduleKey === "starter-one" &&
      item.surfaceId === "starter-summary",
  );
  assert(aAfterOne && aAfterSummary && bAfterOne && bAfterSummary);

  assert.equal(aAfterOne.visible, false);
  assert.equal(aAfterOne.displayOrder, 1);
  assert.equal(aAfterSummary.visible, true);
  assert.equal(aAfterSummary.displayOrder, 0);

  assert.equal(bAfterOne.visible, true);
  assert.equal(bAfterSummary.visible, true);
  assert.notEqual(bAfterOne.id, aAfterOne.id);
  assert.notEqual(bAfterSummary.id, aAfterSummary.id);

  const feedA = await sync.getChanges(contextA, 0n, 100);
  const feedB = await sync.getChanges(contextB, 0n, 100);
  const privateA = feedA.changes.filter(
    (change) => change.entityType === "member-module-preference",
  );
  const privateB = feedB.changes.filter(
    (change) => change.entityType === "member-module-preference",
  );
  assert.equal(privateA.length, 2);
  assert.equal(privateB.length, 0);
  const raw = await database.db.execute(
    `SELECT
       recipient_user_id::text AS "recipientUserId",
       count(*)::int AS count
     FROM core.change_log
     WHERE entity_type = 'member-module-preference'
     GROUP BY recipient_user_id`,
  );
  assert.equal(raw.rows.length, 1);
  assert.equal(raw.rows[0]?.recipientUserId, USER_A);
  assert.equal(Number(raw.rows[0]?.count ?? -1), 2);

  console.log(
    "PASS_57_MEMBER_MODULE_PREFERENCES " +
      "multi-card-module=independent " +
      "duplicate-card-types=allowed " +
      "member-layouts=independent " +
      "private-sync=isolated " +
      "replay=verified " +
      "conflict=verified",
  );
} finally {
  await database.close();
}
