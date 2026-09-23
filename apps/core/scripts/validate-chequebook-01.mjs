import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Fastify from "fastify";
import { Client } from "pg";
import { createHomiDatabase } from "@homi/db";
import { installHomiModule } from "../dist/module-installer.js";
import { loadHomiServerModules } from "../dist/module-host.js";
import { createHomiHouseholdModuleService } from "../dist/household-modules.js";
import { createHomiMemberModulePreferenceService } from "../dist/member-module-preferences.js";
import { createHomiModuleSyncService } from "../dist/module-sync.js";

const migratorUrl = process.env.HOMI_TEST_MIGRATOR_DATABASE_URL;
const appUrl = process.env.HOMI_TEST_APP_DATABASE_URL;
if (!migratorUrl || !appUrl) throw new Error("HOMI_TEST_MIGRATOR_DATABASE_URL and HOMI_TEST_APP_DATABASE_URL are required.");

const packageDirectory = fileURLToPath(new URL("../../../packages/chequebook/", import.meta.url));
const coreRoot = fileURLToPath(new URL("../", import.meta.url));
const installRoot = await mkdtemp(join(coreRoot, ".homi-modules-chequebook01-"));
const USER = "11111111-1111-4111-8111-111111111111";
const HOUSEHOLD = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP = "33333333-3333-4333-8333-333333333333";
const PERSON = "44444444-4444-4444-8444-444444444444";
const CLIENT = "55555555-5555-4555-8555-555555555555";
const INSTANCE = "66666666-6666-4666-8666-666666666666";
const TX = "77777777-7777-4777-8777-777777777777";
const RULE = "88888888-8888-4888-8888-888888888888";
const LIMIT = "99999999-9999-4999-8999-999999999999";
const context = Object.freeze({
  requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  userId: USER, householdId: HOUSEHOLD, membershipId: MEMBERSHIP,
  householdPersonId: PERSON, clientId: CLIENT, locale: "en-CA",
  timeZone: "America/Toronto",
});

async function ownerQuery(sql, params = []) {
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

function mutation(clientMutationId, entityType, entityId, operation, baseRevision, payload) {
  return { clientMutationId, moduleKey: "chequebook", entityType, entityId, operation, baseRevision, payload };
}

try {
  const installed = await installHomiModule({ packageDirectory, installRoot, databaseUrl: migratorUrl });
  assert.equal(installed.status, "installed");
  assert.equal(installed.moduleKey, "chequebook");
  assert.equal(installed.version, "0.1.11");
  assert.deepEqual(installed.appliedMigrations, ["0000_chequebook_initial.sql"]);

  await ownerQuery(
    `INSERT INTO core.users (id,auth_subject,display_name,preferred_locale,time_zone)
     VALUES ($1::uuid,'chequebook-acceptance','Chequebook User','en-CA','America/Toronto')`,
    [USER],
  );
  await ownerQuery(
    `INSERT INTO core.households (id,name,default_locale,time_zone,created_by_user_id)
     VALUES ($1::uuid,'Chequebook Home','en-CA','America/Toronto',$2::uuid)`,
    [HOUSEHOLD,USER],
  );
  await ownerQuery(
    `INSERT INTO core.household_memberships (id,household_id,user_id,status)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'active')`,
    [MEMBERSHIP,HOUSEHOLD,USER],
  );
  await ownerQuery(
    `INSERT INTO core.household_people (id,household_id,linked_membership_id,display_name,status)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'Chequebook User','active')`,
    [PERSON,HOUSEHOLD,MEMBERSHIP],
  );
  await ownerQuery(
    `INSERT INTO core.clients (id,user_id,client_instance_id,label,platform,app_version)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'Chequebook Acceptance','test','0.1.4')`,
    [CLIENT,USER,INSTANCE],
  );

  const database = createHomiDatabase(appUrl);
  const requestContext = Object.freeze({
    async resolve(input) {
      return Object.freeze({ ...context, requestId: input.requestId ?? context.requestId, ...(input.clientId ? { clientId: input.clientId } : {}) });
    },
  });

  try {
    const modules = await loadHomiServerModules({ installRoot, database: database.db, requestContext });
    assert.equal(modules.length, 1);
    assert.equal(modules[0]?.moduleKey, "chequebook");
    assert.equal(modules[0]?.mutationHandlers?.length, 6);
    assert.equal(modules[0]?.brokerProviders?.length, 1);
    assert.equal(modules[0]?.jobHandlers?.length, 1);

    const lifecycle = createHomiHouseholdModuleService(database.db, modules);
    const sync = createHomiModuleSyncService(database.db, modules);
    const initial = (await lifecycle.list(context)).find((item) => item.moduleKey === "chequebook");
    assert(initial);
    assert.equal(initial.enabled, false);
    assert.equal(initial.setupState, "unconfigured");

    const enabled = await lifecycle.setEnabled(context, "chequebook", { enabled: true, baseRevision: 0n });
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.revision, 1n);

    const app = Fastify({ logger: false });
    for (const module of modules) await module.register(app);
    await app.ready();
    const headers = { "x-homi-household-id": HOUSEHOLD, "x-homi-client-id": CLIENT };

    const setup = await app.inject({
      method: "PUT", url: "/api/v1/modules/chequebook/setup", headers,
      payload: { currency: "CAD", accountName: "Household chequing", openingBalance: "1000.00", openingDate: "2026-09-01" },
    });
    assert.equal(setup.statusCode, 200, setup.body);
    assert.equal(setup.json().data.settings.currency, "CAD");
    const accountId = setup.json().data.accounts[0].id;
    const groceries = setup.json().data.categories.find((item) => item.name === "Groceries");
    assert(groceries);

    const renamedCategory = await sync.applyMutation(context, mutation(
      "abababab-abab-4bab-8bab-abababababab", "category", groceries.id, "update", 1n,
      { name:"Food & groceries", kind:"expense", color:groceries.color, archived:false },
    ));
    assert.equal(renamedCategory.status, "applied");
    assert.equal(renamedCategory.serverState.name, "Food & groceries");

    const chequebookProvider = modules[0]?.brokerProviders?.find(
      (provider) => provider.capability === "chequebook.transactions.v1",
    );
    assert(chequebookProvider);
    const options = await chequebookProvider.handle(context, {
      action: "options",
      payload: {},
    });
    assert.equal(options.configured, true);
    assert.equal(options.defaultAccountId, accountId);

    const linkedSourceId = "12121212-1212-4212-8212-121212121212";
    const linked = await chequebookProvider.handle(context, {
      action: "upsert-linked-recurring",
      payload: {
        sourceModule:"calendar", sourceEntityType:"event",
        sourceEntityId:linkedSourceId, accountId,
        categoryId:groceries.id, kind:"expense", amount:"42.00",
        label:"Calendar-linked bill", notes:null,
        startDate:"2026-10-01", frequency:"monthly", interval:1,
        recurrenceUntil:null, active:true,
      },
    });
    assert.equal(linked.targetType, "recurring-rule");
    assert.match(linked.targetId, /^[0-9a-f-]{36}$/i);

    const linkedLookup = await chequebookProvider.handle(context, {
      action: "get-linked-transaction",
      payload: {
        sourceModule:"calendar", sourceEntityType:"event",
        sourceEntityId:linkedSourceId,
      },
    });
    assert.deepEqual(linkedLookup, {
      targetType: "recurring-rule",
      targetId: linked.targetId,
    });

    const removedLink = await chequebookProvider.handle(context, {
      action: "remove-linked-entry",
      payload: {
        sourceModule:"calendar", sourceEntityType:"event",
        sourceEntityId:linkedSourceId,
      },
    });
    assert.equal(removedLink.removed, true);

    const tx = await sync.applyMutation(context, mutation(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "transaction", TX, "create", 0n,
      { kind:"expense", accountId, transferAccountId:null, categoryId:groceries.id,
        personId:PERSON, amount:"125.50", description:"Groceries", payee:"Market",
        date:"2026-09-20", cleared:true, reconciledAt:null, notes:null,
        recurringRuleId:null, recurringOccurrenceDate:null, calendarLinkEnabled:false },
    ));
    assert.equal(tx.status, "applied");
    assert.equal(tx.serverRevision, "1");

    const replay = await sync.applyMutation(context, mutation(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "transaction", TX, "create", 0n,
      { kind:"expense", accountId, transferAccountId:null, categoryId:groceries.id,
        personId:PERSON, amount:"125.50", description:"Groceries", payee:"Market",
        date:"2026-09-20", cleared:true, reconciledAt:null, notes:null,
        recurringRuleId:null, recurringOccurrenceDate:null, calendarLinkEnabled:false },
    ));
    assert.equal(replay.replayed, true);

    const stale = await sync.applyMutation(context, mutation(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "transaction", TX, "update", 0n,
      { kind:"expense", accountId, transferAccountId:null, categoryId:groceries.id,
        personId:PERSON, amount:"130.00", description:"Wrong stale update", payee:"Market",
        date:"2026-09-20", cleared:true, reconciledAt:null, notes:null,
        recurringRuleId:null, recurringOccurrenceDate:null, calendarLinkEnabled:false },
    ));
    assert.equal(stale.status, "conflict");
    assert.equal(stale.serverRevision, "1");

    const rule = await sync.applyMutation(context, mutation(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "recurring-rule", RULE, "create", 0n,
      { kind:"expense", accountId, transferAccountId:null, categoryId:groceries.id,
        personId:PERSON, amount:"75.00", label:"Weekly groceries", notes:null,
        startDate:"2026-09-21", frequency:"weekly", interval:1,
        recurrenceUntil:null, active:true, calendarLinkEnabled:false },
    ));
    assert.equal(rule.status, "applied");

    const attached = await sync.applyMutation(context, mutation(
      "12121212-1212-4212-8212-121212121212", "transaction", TX, "update", 1n,
      { kind:"expense", accountId, transferAccountId:null, categoryId:groceries.id,
        personId:PERSON, amount:"75.00", description:"Weekly groceries", payee:"Market",
        date:"2026-09-21", cleared:true, reconciledAt:null, notes:null,
        recurringRuleId:RULE, recurringOccurrenceDate:"2026-09-21", calendarLinkEnabled:false },
    ));
    assert.equal(attached.status, "applied");
    assert.equal(attached.serverRevision, "2");

    const detached = await sync.applyMutation(context, mutation(
      "13131313-1313-4313-8313-131313131313", "transaction", TX, "update", 2n,
      { kind:"expense", accountId, transferAccountId:null, categoryId:groceries.id,
        personId:PERSON, amount:"125.50", description:"Groceries", payee:"Market",
        date:"2026-09-20", cleared:true, reconciledAt:null, notes:null,
        recurringRuleId:null, recurringOccurrenceDate:null, calendarLinkEnabled:false },
    ));
    assert.equal(detached.status, "applied");
    assert.equal(detached.serverRevision, "3");
    const occurrenceProof = await ownerQuery(
      `SELECT status,posted_transaction_id::text AS "postedTransactionId"
       FROM mod_chequebook.recurring_occurrences
       WHERE recurring_rule_id=$1::uuid AND occurrence_date='2026-09-21'::date`,
      [RULE],
    );
    assert.deepEqual(occurrenceProof.rows, [{ status:"skipped", postedTransactionId:null }]);

    const limit = await sync.applyMutation(context, mutation(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "budget-limit", LIMIT, "create", 0n,
      { categoryId:groceries.id, budgetMonth:"2026-09-01", amount:"500.00", rolloverEnabled:false },
    ));
    assert.equal(limit.status, "applied");

    const summary = await app.inject({
      method:"GET", url:"/api/v1/modules/chequebook/summary?month=2026-09-01&asOf=2026-09-20", headers,
    });
    assert.equal(summary.statusCode, 200, summary.body);
    assert.equal(summary.json().data.expenses, "125.50");
    assert.equal(summary.json().data.currentBalance, "874.50");
    assert.equal(summary.json().data.upcomingRecurringExpenses, "75.00");
    assert.equal(summary.json().data.forecastBalance, "799.50");
    assert.equal(summary.json().data.spentByCategory.find((item) => item.categoryId === groceries.id).percentUsed, 40.1);

    const preferences = createHomiMemberModulePreferenceService(database.db);
    const cards = await preferences.list(context);
    assert.deepEqual(cards.map((card) => card.surfaceId), ["current-balance","monthly-spend","cash-flow-forecast"]);

    const disabled = await lifecycle.setEnabled(context, "chequebook", { enabled:false, baseRevision:1n });
    assert.equal(disabled.revision, 2n);
    const blocked = await app.inject({ method:"GET", url:"/api/v1/modules/chequebook/transactions", headers });
    assert.equal(blocked.statusCode, 403);
    const reenabled = await lifecycle.setEnabled(context, "chequebook", { enabled:true, baseRevision:2n });
    assert.equal(reenabled.revision, 3n);
    const preserved = await app.inject({ method:"GET", url:`/api/v1/modules/chequebook/transactions/${TX}`, headers });
    assert.equal(preserved.statusCode, 200);
    assert.equal(preserved.json().data.description, "Groceries");
    await app.close();

    const webModule = await import(pathToFileURL(join(packageDirectory, "dist/web.js")).href);
    const definition = webModule.createHomiWebModule({
      authSubject:USER, householdId:HOUSEHOLD, clientId:CLIENT,
      locale:"en-CA", timeZone:"America/Toronto", online:true,
    });
    assert.equal(definition.moduleKey, "chequebook");
    assert.ok(definition.pages.chequebook);
    assert.deepEqual(Object.keys(definition.familyBoard ?? {}).sort(), ["cash-flow-forecast","current-balance","monthly-spend"]);
    assert.equal(definition.sync?.mutationAdapters?.length, 6);
    assert.equal(definition.sync?.changeHandlers?.length, 6);
  } finally {
    await database.close();
  }

  const proof = await ownerQuery(
    `SELECT
       (SELECT count(*)::int FROM mod_chequebook.transactions WHERE household_id=$1::uuid AND deleted_at IS NULL) AS transactions,
       (SELECT count(*)::int FROM mod_chequebook.recurring_rules WHERE household_id=$1::uuid AND deleted_at IS NULL) AS recurring,
       (SELECT count(*)::int FROM mod_chequebook.budget_limits WHERE household_id=$1::uuid AND deleted_at IS NULL) AS budgets`,
    [HOUSEHOLD],
  );
  assert.deepEqual(proof.rows, [{ transactions:1, recurring:1, budgets:1 }]);
  console.log("PASS_CHEQUEBOOK_01_REAL_POSTGRES managed-install=yes setup=yes categories-editable=yes family-category-sync=yes transactions=yes replay=yes conflict=yes recurring=yes calendar-to-chequebook-link=yes transaction-recurrence-attach-detach=yes budget=yes forecast=yes disable-reenable-preserves-data=yes home-cards=3 web-contract=yes");
} finally {
  await rm(installRoot, { recursive:true, force:true });
}
