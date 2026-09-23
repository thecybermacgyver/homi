import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { createHomiDatabase } from "@homi/db";
import {
  HomiHouseholdModuleError,
  createHomiHouseholdModuleService,
} from "../dist/household-modules.js";

const databaseUrl = process.env.HOMI_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("HOMI_TEST_DATABASE_URL is required.");
}

const USER_ID = "11111111-1111-4111-8111-111111111111";
const HOUSEHOLD_ID = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333";
const PERSON_ID = "44444444-4444-4444-8444-444444444444";
const SECOND_HOUSEHOLD_ID =
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_MEMBERSHIP_ID =
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECOND_PERSON_ID =
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CLIENT_ID = "55555555-5555-4555-8555-555555555555";
const ITEM_ID = "99999999-9999-4999-8999-999999999999";
const REQUEST_ID = "77777777-7777-4777-8777-777777777777";

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

const secondContext = Object.freeze({
  ...context,
  requestId: "12121212-1212-4121-8121-121212121212",
  householdId: SECOND_HOUSEHOLD_ID,
  membershipId: SECOND_MEMBERSHIP_ID,
  householdPersonId: SECOND_PERSON_ID,
});

const configuredHouseholds = new Set();

const runtime = Object.freeze({
  moduleKey: "starter",
  moduleApiVersion: 1,
  register() {},
  getSetupStatus(setupContext) {
    return {
      state: configuredHouseholds.has(
        setupContext.householdId,
      )
        ? "configured"
        : "unconfigured",
    };
  },
});

const database = createHomiDatabase(databaseUrl);
const service = createHomiHouseholdModuleService(
  database.db,
  [runtime],
);

function starter(modules) {
  const module = modules.find(
    (item) => item.moduleKey === "starter",
  );
  assert.ok(module, "starter module must be present");
  return module;
}

try {
  const initial = starter(await service.list(context));
  assert.equal(initial.available, true);
  assert.equal(initial.enabled, false);
  assert.equal(initial.revision, 0n);
  assert.equal(initial.setupRequired, true);
  assert.equal(initial.setupState, "unconfigured");

  const unchangedOff = await service.setEnabled(
    context,
    "starter",
    {
      enabled: false,
      baseRevision: 0n,
    },
  );
  assert.equal(unchangedOff.enabled, false);
  assert.equal(unchangedOff.revision, 0n);

  const enabled = await service.setEnabled(
    context,
    "starter",
    {
      enabled: true,
      baseRevision: 0n,
    },
  );
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.revision, 1n);
  assert.equal(enabled.setupState, "unconfigured");

  await database.db.execute(sql`
    INSERT INTO mod_starter.items (
      id,
      household_id,
      title
    )
    VALUES (
      CAST(${ITEM_ID} AS uuid),
      CAST(${HOUSEHOLD_ID} AS uuid),
      'Preserved module data'
    )
  `);

  await assert.rejects(
    () =>
      service.setEnabled(
        context,
        "starter",
        {
          enabled: false,
          baseRevision: 0n,
        },
      ),
    (error) =>
      error instanceof HomiHouseholdModuleError &&
      error.code === "REVISION_CONFLICT" &&
      error.statusCode === 409,
  );

  configuredHouseholds.add(HOUSEHOLD_ID);

  const configuredWhileEnabled = starter(
    await service.list(context),
  );
  assert.equal(
    configuredWhileEnabled.setupState,
    "configured",
  );

  const disabled = await service.setEnabled(
    context,
    "starter",
    {
      enabled: false,
      baseRevision: 1n,
    },
  );
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.revision, 2n);
  assert.equal(disabled.setupState, "configured");

  const dataWhileDisabled = await database.db.execute(sql`
    SELECT count(*)::int AS count
    FROM mod_starter.items
    WHERE household_id =
      CAST(${HOUSEHOLD_ID} AS uuid)
      AND id = CAST(${ITEM_ID} AS uuid)
  `);
  assert.equal(
    Number(dataWhileDisabled.rows[0]?.count ?? -1),
    1,
  );

  const reenabled = await service.setEnabled(
    context,
    "starter",
    {
      enabled: true,
      baseRevision: 2n,
    },
  );
  assert.equal(reenabled.enabled, true);
  assert.equal(reenabled.revision, 3n);
  assert.equal(reenabled.setupState, "configured");

  const noOpEnabled = await service.setEnabled(
    context,
    "starter",
    {
      enabled: true,
      baseRevision: 3n,
    },
  );
  assert.equal(noOpEnabled.revision, 3n);

  const dataAfterReenable = await database.db.execute(sql`
    SELECT count(*)::int AS count
    FROM mod_starter.items
    WHERE household_id =
      CAST(${HOUSEHOLD_ID} AS uuid)
      AND id = CAST(${ITEM_ID} AS uuid)
  `);
  assert.equal(
    Number(dataAfterReenable.rows[0]?.count ?? -1),
    1,
  );

  const history = await database.db.execute(sql`
    SELECT
      operation,
      revision::text AS revision
    FROM core.change_log
    WHERE household_id =
        CAST(${HOUSEHOLD_ID} AS uuid)
      AND module_key = 'core'
      AND entity_type = 'household-module'
    ORDER BY sequence
  `);
  assert.deepEqual(
    history.rows.map((row) => ({
      operation: row.operation,
      revision: row.revision,
    })),
    [
      { operation: "create", revision: "1" },
      { operation: "update", revision: "2" },
      { operation: "update", revision: "3" },
    ],
  );

  const audit = await database.db.execute(sql`
    SELECT count(*)::int AS count
    FROM core.audit_log
    WHERE household_id =
        CAST(${HOUSEHOLD_ID} AS uuid)
      AND target_type = 'household-module'
  `);
  assert.equal(Number(audit.rows[0]?.count ?? -1), 3);

  const outbox = await database.db.execute(sql`
    SELECT count(*)::int AS count
    FROM core.event_outbox
    WHERE household_id =
        CAST(${HOUSEHOLD_ID} AS uuid)
      AND aggregate_type = 'household-module'
  `);
  assert.equal(Number(outbox.rows[0]?.count ?? -1), 3);

  const failingStatusService =
    createHomiHouseholdModuleService(
      database.db,
      [
        {
          ...runtime,
          getSetupStatus() {
            throw new Error("module status failure");
          },
        },
      ],
    );
  const contained = starter(
    await failingStatusService.list(context),
  );
  assert.equal(contained.setupState, "unavailable");

  console.log(
    "PASS_55_REAL_POSTGRES_HOUSEHOLD_MODULE_LIFECYCLE",
  );
} finally {
  await database.close();
}
