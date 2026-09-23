import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Fastify from "fastify";
import { Client } from "pg";
import { createHomiDatabase } from "@homi/db";
import {
  adoptLegacyHomiModule,
  installHomiModule,
} from "../dist/module-installer.js";
import { inspectHomiModulePackage } from "../dist/module-package.js";
import { loadHomiServerModules } from "../dist/module-host.js";
import { createHomiModuleSyncService } from "../dist/module-sync.js";
import { createHomiModuleJobRunner } from "../dist/module-jobs.js";
import {
  createHomiHouseholdModuleService,
} from "../dist/household-modules.js";
import {
  createHomiMemberModulePreferenceService,
} from "../dist/member-module-preferences.js";

const migratorUrl = process.env.HOMI_TEST_MIGRATOR_DATABASE_URL;
const appUrl = process.env.HOMI_TEST_APP_DATABASE_URL;
if (!migratorUrl || !appUrl) {
  throw new Error(
    "HOMI_TEST_MIGRATOR_DATABASE_URL and HOMI_TEST_APP_DATABASE_URL are required.",
  );
}

const calendarDirectory = fileURLToPath(
  new URL("../../../packages/calendar/", import.meta.url),
);
const coreRoot = fileURLToPath(new URL("../", import.meta.url));
const installRoot = await mkdtemp(
  join(coreRoot, ".homi-modules-calendar60-"),
);

const USER_ID = "11111111-1111-4111-8111-111111111111";
const HOUSEHOLD_ID = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333";
const PERSON_ID = "44444444-4444-4444-8444-444444444444";
const CLIENT_ID = "55555555-5555-4555-8555-555555555555";
const CLIENT_INSTANCE_ID = "66666666-6666-4666-8666-666666666666";
const MODULE_ID = "77777777-7777-4777-8777-777777777777";
const VERSION_ID = "88888888-8888-4888-8888-888888888888";
const CALENDAR_ID = "99999999-9999-4999-8999-999999999999";
const EVENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const context = Object.freeze({
  requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  userId: USER_ID,
  householdId: HOUSEHOLD_ID,
  membershipId: MEMBERSHIP_ID,
  householdPersonId: PERSON_ID,
  clientId: CLIENT_ID,
  locale: "en-CA",
  timeZone: "America/Toronto",
});

const prepared = await inspectHomiModulePackage(calendarDirectory);
assert.equal(prepared.manifest.moduleKey, "calendar");
assert.equal(prepared.manifest.version, "0.6.7");
const legacyMigrations = prepared.migrations.filter(
  (migration) =>
    migration.id !== "0004_external_sync_ics.sql" &&
    migration.id !== "0005_event_colors.sql",
);
assert.equal(legacyMigrations.length, 4);
assert.equal(prepared.migrations.length, 6);
assert.deepEqual(
  prepared.manifest.extensions.familyBoard.map((card) => ({
    surfaceId: card.surfaceId,
    label: card.label,
    slot: card.slot,
  })),
  [
    {
      surfaceId: "today-count",
      label: "Events today",
      slot: "family-schedule",
    },
    {
      surfaceId: "coming-week",
      label: "Coming week",
      slot: "family-schedule",
    },
    {
      surfaceId: "mini-month",
      label: "Mini month",
      slot: "family-schedule",
    },
  ],
);

const owner = new Client({ connectionString: migratorUrl });
await owner.connect();

try {
  await owner.query("SET ROLE homi_owner");

  for (const migration of legacyMigrations) {
    if (migration.id === "0000_calendar_initial.sql") {
      await owner.query(
        "CREATE SCHEMA mod_calendar AUTHORIZATION homi_owner",
      );
    }
    await owner.query(migration.sql);
  }

  // Reproduce the production 0.5 legacy schema that predates managed-module
  // adoption. Calendar 0.6.7 must reconcile these constraints rather than
  // assuming a pristine migration-created schema.
  await owner.query(`
    ALTER TABLE mod_calendar.calendars
      ADD CONSTRAINT ck_calendar_calendars_color
      CHECK (color IN (
        'red','orange','yellow','lime','green','dark green','aqua','cyan',
        'blue','navy','purple','violet','pink','magenta','brown','black'
      ));

    ALTER TABLE mod_calendar.calendars
      ADD CONSTRAINT ck_calendar_calendars_kind
      CHECK (kind = 'local');

    ALTER TABLE mod_calendar.events
      ALTER COLUMN starts_at SET NOT NULL,
      ALTER COLUMN ends_at SET NOT NULL;

    ALTER TABLE mod_calendar.events
      DROP CONSTRAINT ck_mod_calendar_event_dates;

    ALTER TABLE mod_calendar.events
      ADD CONSTRAINT ck_calendar_events_date_shape
      CHECK (
        (
          NOT all_day
          AND start_date IS NULL
          AND end_date_exclusive IS NULL
        )
        OR
        (
          all_day
          AND start_date IS NOT NULL
          AND end_date_exclusive IS NOT NULL
          AND end_date_exclusive > start_date
        )
      );
  `);

  await owner.query(
    `CREATE TABLE mod_calendar.schema_migrations (
       id text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  for (const migration of legacyMigrations) {
    await owner.query(
      `INSERT INTO mod_calendar.schema_migrations (id)
       VALUES ($1)`,
      [migration.id],
    );
  }

  const legacyManifest = structuredClone(prepared.manifest);
  legacyManifest.version = "0.4.0";
  legacyManifest.entrypoints = {
    server: "./dist/server-module.js",
  };
  legacyManifest.extensions.familyBoard = [];

  await owner.query(
    `INSERT INTO core.users (
       id, auth_subject, display_name, preferred_locale, time_zone
     )
     VALUES (
       $1::uuid, 'calendar-legacy-user', 'Legacy User',
       'en-CA', 'America/Toronto'
     )`,
    [USER_ID],
  );
  await owner.query(
    `INSERT INTO core.households (
       id, name, default_locale, time_zone, created_by_user_id
     )
     VALUES (
       $1::uuid, 'Legacy Calendar Home',
       'en-CA', 'America/Toronto', $2::uuid
     )`,
    [HOUSEHOLD_ID, USER_ID],
  );
  await owner.query(
    `INSERT INTO core.household_memberships (
       id, household_id, user_id, status
     )
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'active')`,
    [MEMBERSHIP_ID, HOUSEHOLD_ID, USER_ID],
  );
  await owner.query(
    `INSERT INTO core.household_people (
       id, household_id, linked_membership_id,
       display_name, status
     )
     VALUES (
       $1::uuid, $2::uuid, $3::uuid,
       'Legacy User', 'active'
     )`,
    [PERSON_ID, HOUSEHOLD_ID, MEMBERSHIP_ID],
  );
  await owner.query(
    `INSERT INTO core.clients (
       id, user_id, client_instance_id,
       label, platform, app_version
     )
     VALUES (
       $1::uuid, $2::uuid, $3::uuid,
       'Calendar conformance', 'test', '6.0'
     )`,
    [CLIENT_ID, USER_ID, CLIENT_INSTANCE_ID],
  );
  await owner.query(
    `INSERT INTO core.modules (
       id, module_key, name, publisher,
       state, current_version, manifest
     )
     VALUES (
       $1::uuid, 'calendar', 'Calendar', 'Homi',
       'installed', '0.4.0', $2::jsonb
     )`,
    [MODULE_ID, JSON.stringify(legacyManifest)],
  );
  await owner.query(
    `INSERT INTO core.module_versions (
       id, module_id, version, package_digest,
       manifest, migration_state
     )
     VALUES (
       $1::uuid, $2::uuid, '0.4.0',
       'sha256:legacy-calendar-040',
       $3::jsonb, 'applied'
     )`,
    [VERSION_ID, MODULE_ID, JSON.stringify(legacyManifest)],
  );
  await owner.query(
    `INSERT INTO core.household_modules (
       household_id, module_id, enabled,
       enabled_by_user_id, revision
     )
     VALUES (
       $1::uuid, $2::uuid, true, $3::uuid, 1
     )`,
    [HOUSEHOLD_ID, MODULE_ID, USER_ID],
  );

  await owner.query(
    `INSERT INTO mod_calendar.calendars (
       id, household_id, name, color, kind, revision
     )
     VALUES (
       $1::uuid, $2::uuid,
       'Household', 'blue', 'local', 1
     )`,
    [CALENDAR_ID, HOUSEHOLD_ID],
  );
  await owner.query(
    `INSERT INTO mod_calendar.settings (
       household_id, state, default_view, week_start,
       time_zone, default_reminder, revision,
       default_calendar_id
     )
     VALUES (
       $1::uuid, 'configured', 'month', 'sunday',
       'America/Toronto', 'none', 4, $2::uuid
     )`,
    [HOUSEHOLD_ID, CALENDAR_ID],
  );
  await owner.query(
    `INSERT INTO mod_calendar.events (
       id, household_id, title, starts_at, ends_at,
       all_day, location, notes, revision,
       created_by_user_id, updated_by_user_id,
       calendar_id, time_zone, description,
       recurrence, recurrence_overrides,
       person_ids, reminder_minutes, transport
     )
     VALUES (
       $1::uuid, $2::uuid, 'Preserved family event',
       '2026-09-21T18:00:00Z'::timestamptz,
       '2026-09-21T19:00:00Z'::timestamptz,
       false, 'Home', 'Keep this event', 7,
       $3::uuid, $3::uuid, $4::uuid,
       'America/Toronto', 'Legacy 0.4 data',
       NULL, '[]'::jsonb, ARRAY[$5::uuid],
       ARRAY[30]::integer[],
       '{"mode":"none","notes":null,"pickupPersonId":null,"dropoffPersonId":null}'::jsonb
     )`,
    [
      EVENT_ID,
      HOUSEHOLD_ID,
      USER_ID,
      CALENDAR_ID,
      PERSON_ID,
    ],
  );

  await owner.query("RESET ROLE");
} finally {
  await owner.end();
}

try {
  const adopted = await adoptLegacyHomiModule({
    packageDirectory: calendarDirectory,
    databaseUrl: migratorUrl,
  });
  assert.equal(adopted.status, "adopted");
  assert.equal(adopted.currentVersion, "0.4.0");
  assert.equal(adopted.candidateVersion, "0.6.7");
  assert.deepEqual(
    adopted.adoptedMigrations,
    legacyMigrations.map((migration) => migration.id),
  );

  const verifyAdoption = new Client({
    connectionString: migratorUrl,
  });
  await verifyAdoption.connect();
  try {
    await verifyAdoption.query("SET ROLE homi_owner");
    const ledger = await verifyAdoption.query(
      `SELECT id, checksum, module_version AS "moduleVersion"
       FROM mod_calendar.schema_migrations
       ORDER BY id`,
    );
    assert.deepEqual(
      ledger.rows,
      legacyMigrations.map((migration) => ({
        id: migration.id,
        checksum: migration.checksum,
        moduleVersion: "0.4.0",
      })),
    );
    await verifyAdoption.query("RESET ROLE");
  } finally {
    await verifyAdoption.end();
  }

  const installed = await installHomiModule({
    packageDirectory: calendarDirectory,
    installRoot,
    databaseUrl: migratorUrl,
  });
  assert.equal(installed.status, "installed");
  assert.equal(installed.fromVersion, "0.4.0");
  assert.equal(installed.version, "0.6.7");
  assert.deepEqual(installed.appliedMigrations, [
    "0004_external_sync_ics.sql",
    "0005_event_colors.sql",
  ]);

  const database = createHomiDatabase(appUrl);
  const requestContext = Object.freeze({
    async resolve(input) {
      return Object.freeze({
        ...context,
        requestId: input.requestId ?? context.requestId,
        ...(input.clientId
          ? { clientId: input.clientId }
          : {}),
      });
    },
  });

  try {
    const legacyCrashEntrypoint = join(
      installRoot,
      "legacy-calendar-should-not-load.mjs",
    );
    await writeFile(
      legacyCrashEntrypoint,
      `throw new Error("legacy Calendar entrypoint must not load when managed Calendar is active");\n`,
      "utf8",
    );

    const modules = await loadHomiServerModules({
      legacyEntrypoints: legacyCrashEntrypoint,
      installRoot,
      database: database.db,
      requestContext,
      moduleSecretMaster:
        "calendar-conformance-secret-material-123456",
    });
    assert.equal(modules.length, 1);
    assert.equal(modules[0]?.moduleKey, "calendar");
    assert.equal(modules[0]?.moduleApiVersion, 1);
    assert.equal(modules[0]?.mutationHandlers?.length, 3);
    assert.equal(modules[0]?.brokerProviders?.length, 3);
    assert.equal(modules[0]?.jobHandlers?.length, 2);

    const lifecycle = createHomiHouseholdModuleService(
      database.db,
      modules,
    );
    const calendarState = (
      await lifecycle.list(context)
    ).find((module) => module.moduleKey === "calendar");
    assert(calendarState);
    assert.equal(calendarState.enabled, true);
    assert.equal(calendarState.setupState, "configured");
    assert.equal(calendarState.version, "0.6.7");

    const preferences =
      createHomiMemberModulePreferenceService(database.db);
    const cards = await preferences.list(context);
    assert.deepEqual(
      cards.map((card) => ({
        surfaceId: card.surfaceId,
        label: card.label,
        visible: card.visible,
      })),
      [
        {
          surfaceId: "today-count",
          label: "Events today",
          visible: true,
        },
        {
          surfaceId: "coming-week",
          label: "Coming week",
          visible: true,
        },
        {
          surfaceId: "mini-month",
          label: "Mini month",
          visible: true,
        },
      ],
    );

    const app = Fastify({ logger: false });
    for (const module of modules) {
      await module.register(app);
    }
    await app.ready();

    const headers = {
      "x-homi-household-id": HOUSEHOLD_ID,
      "x-homi-client-id": CLIENT_ID,
    };

    const missingChequebook = await app.inject({
      method: "GET",
      url: "/api/v1/modules/calendar/chequebook/options",
      headers,
    });
    assert.equal(missingChequebook.statusCode, 409);
    assert.equal(
      missingChequebook.json().code,
      "CALENDAR_CHEQUEBOOK_UNAVAILABLE",
    );
    assert.match(
      missingChequebook.json().message,
      /Install Chequebook/,
    );

    const people = await app.inject({
      method: "GET",
      url: "/api/v1/modules/calendar/people",
      headers,
    });
    assert.equal(people.statusCode, 200);
    assert.deepEqual(people.json().data, [
      {
        id: PERSON_ID,
        displayName: "Legacy User",
        avatarFileId: null,
      },
    ]);

    const settings = await app.inject({
      method: "GET",
      url: "/api/v1/modules/calendar/setup",
      headers,
    });
    assert.equal(settings.statusCode, 200);
    assert.equal(settings.json().data.state, "configured");
    assert.equal(settings.json().data.revision, "4");
    assert.equal(
      settings.json().data.defaultCalendarId,
      CALENDAR_ID,
    );

    const event = await app.inject({
      method: "GET",
      url: `/api/v1/modules/calendar/events/${EVENT_ID}`,
      headers,
    });
    assert.equal(event.statusCode, 200);
    assert.equal(event.json().data.title, "Preserved family event");
    assert.equal(event.json().data.revision, "7");
    assert.deepEqual(event.json().data.personIds, [PERSON_ID]);

    const moduleSync = createHomiModuleSyncService(
      database.db,
      modules,
    );

    const rollbackOwner = new Client({ connectionString: migratorUrl });
    await rollbackOwner.connect();
    try {
      await rollbackOwner.query("SET ROLE homi_owner");
      await rollbackOwner.query(`
        CREATE OR REPLACE FUNCTION core.calendar60_fail_audit()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.request_id = 'calendar60-rollback-proof' THEN
            RAISE EXCEPTION 'calendar60 forced audit failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await rollbackOwner.query(`
        DROP TRIGGER IF EXISTS calendar60_fail_audit
        ON core.audit_log
      `);
      await rollbackOwner.query(`
        CREATE TRIGGER calendar60_fail_audit
        BEFORE INSERT ON core.audit_log
        FOR EACH ROW
        EXECUTE FUNCTION core.calendar60_fail_audit()
      `);
    } finally {
      await rollbackOwner.query("RESET ROLE").catch(() => undefined);
    }

    const ROLLBACK_EVENT_ID =
      "abababab-abab-4bab-8bab-abababababab";
    const ROLLBACK_MUTATION_ID =
      "acacacac-acac-4cac-8cac-acacacacacac";
    await assert.rejects(
      () =>
        moduleSync.applyMutation(
          {
            ...context,
            requestId: "calendar60-rollback-proof",
          },
          {
            clientMutationId: ROLLBACK_MUTATION_ID,
            moduleKey: "calendar",
            entityType: "event",
            entityId: ROLLBACK_EVENT_ID,
            operation: "create",
            baseRevision: 0n,
            payload: {
              calendarId: CALENDAR_ID,
              title: "Rollback proof event",
              description: "Must not survive a Core post-handler failure",
              allDay: false,
              timeZone: "America/Toronto",
              startsAt: "2026-09-23T18:00:00.000Z",
              endsAt: "2026-09-23T19:00:00.000Z",
              startDate: null,
              endDateExclusive: null,
              location: "Home",
              notes: null,
              recurrence: null,
              recurrenceOverrides: [],
              personIds: [PERSON_ID],
              reminderMinutes: [30],
              transport: {
                mode: "none",
                pickupPersonId: null,
                dropoffPersonId: null,
                notes: null,
              },
            },
          },
        ),
      /calendar60 forced audit failure/,
    );

    try {
      await rollbackOwner.query("SET ROLE homi_owner");
      await rollbackOwner.query(`
        DROP TRIGGER IF EXISTS calendar60_fail_audit
        ON core.audit_log
      `);
      await rollbackOwner.query(`
        DROP FUNCTION IF EXISTS core.calendar60_fail_audit()
      `);
    } finally {
      await rollbackOwner.query("RESET ROLE").catch(() => undefined);
      await rollbackOwner.end();
    }

    const rollbackCheck = new Client({ connectionString: appUrl });
    await rollbackCheck.connect();
    try {
      const rollbackState = await rollbackCheck.query(
        `SELECT
           (SELECT count(*)::int
              FROM mod_calendar.events
             WHERE id = $1::uuid) AS events,
           (SELECT count(*)::int
              FROM core.module_jobs
             WHERE payload->>'eventId' = $2::text) AS jobs,
           (SELECT count(*)::int
              FROM core.sync_mutations
             WHERE client_mutation_id = $3::uuid) AS mutations`,
        [
          ROLLBACK_EVENT_ID,
          ROLLBACK_EVENT_ID,
          ROLLBACK_MUTATION_ID,
        ],
      );
      assert.deepEqual(rollbackState.rows, [
        { events: 0, jobs: 0, mutations: 0 },
      ]);
    } finally {
      await rollbackCheck.end();
    }

    const REMINDER_EVENT_ID =
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const reminderMutation = await moduleSync.applyMutation(
      context,
      {
        clientMutationId:
          "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        moduleKey: "calendar",
        entityType: "event",
        entityId: REMINDER_EVENT_ID,
        operation: "create",
        baseRevision: 0n,
        payload: {
          calendarId: CALENDAR_ID,
          title: "Reminder proof event",
          description: "Exercises Core notification delivery",
          allDay: false,
          timeZone: "America/Toronto",
          startsAt: "2026-09-21T18:00:00.000Z",
          endsAt: "2026-09-21T19:00:00.000Z",
          startDate: null,
          endDateExclusive: null,
          location: "Home",
          notes: null,
          recurrence: null,
          recurrenceOverrides: [],
          personIds: [PERSON_ID],
          reminderMinutes: [30],
          transport: {
            mode: "none",
            pickupPersonId: null,
            dropoffPersonId: null,
            notes: null,
          },
        },
      },
    );
    assert.equal(reminderMutation.status, "applied");

    const ALL_DAY_EVENT_ID =
      "edededed-eded-4ded-8ded-edededededed";
    const allDayMutation = await moduleSync.applyMutation(
      context,
      {
        clientMutationId:
          "efefefef-efef-4fef-8fef-efefefefefef",
        moduleKey: "calendar",
        entityType: "event",
        entityId: ALL_DAY_EVENT_ID,
        operation: "create",
        baseRevision: 0n,
        payload: {
          calendarId: CALENDAR_ID,
          title: "All-day production-shape proof",
          description: "Proves legacy NOT NULL timestamps were reconciled",
          allDay: true,
          timeZone: "America/Toronto",
          startsAt: null,
          endsAt: null,
          startDate: "2026-09-22",
          endDateExclusive: "2026-09-23",
          location: null,
          notes: null,
          recurrence: null,
          recurrenceOverrides: [],
          personIds: [PERSON_ID],
          reminderMinutes: [],
          transport: {
            mode: "none",
            pickupPersonId: null,
            dropoffPersonId: null,
            notes: null,
          },
        },
      },
    );
    assert.equal(allDayMutation.status, "applied");
    assert.equal(allDayMutation.serverState?.allDay, true);
    assert.equal(allDayMutation.serverState?.startsAt, null);
    assert.equal(allDayMutation.serverState?.endsAt, null);

    const serviceClient = new Client({ connectionString: appUrl });
    await serviceClient.connect();
    try {
      const reminderJobs = await serviceClient.query(
        `SELECT id::text AS id, status
         FROM core.module_jobs
         WHERE household_id = $1::uuid
           AND job_type = 'event-reminder'
           AND status = 'pending'`,
        [HOUSEHOLD_ID],
      );
      assert.equal(reminderJobs.rows.length, 1);
      await serviceClient.query(
        `UPDATE core.module_jobs
         SET run_at = now() - interval '1 second'
         WHERE id = $1::uuid`,
        [reminderJobs.rows[0].id],
      );

      const runner = createHomiModuleJobRunner(
        database.db,
        modules,
        60_000,
      );
      await runner.tick();

      const notifications = await serviceClient.query(
        `SELECT
           user_id::text AS "userId",
           notification_type AS "notificationType",
           source_module_key AS "sourceModuleKey"
         FROM core.notifications
         WHERE household_id = $1::uuid
           AND source_module_key = 'calendar'`,
        [HOUSEHOLD_ID],
      );
      assert.deepEqual(notifications.rows, [
        {
          userId: USER_ID,
          notificationType: "calendar-reminder",
          sourceModuleKey: "calendar",
        },
      ]);

      const rangeProvider = modules[0].brokerProviders?.find(
        (provider) => provider.capability === "calendar.range.v1",
      );
      const transportProvider = modules[0].brokerProviders?.find(
        (provider) =>
          provider.capability === "calendar.transport.v1",
      );
      const linkedEventsProvider = modules[0].brokerProviders?.find(
        (provider) =>
          provider.capability === "calendar.linked-events.v1",
      );
      assert(rangeProvider && transportProvider && linkedEventsProvider);
      const range = await rangeProvider.handle(context, {
        action: "list-occurrences",
        payload: {
          startDate: "2026-09-20",
          endDateExclusive: "2026-09-23",
          limit: 100,
        },
      });
      assert.equal(
        range.occurrences.some(
          (item) => item.event.title === "Reminder proof event",
        ),
        true,
      );
      const transport = await transportProvider.handle(context, {
        action: "get-event-transport",
        payload: { eventId: REMINDER_EVENT_ID },
      });
      assert.equal(transport.eventId, REMINDER_EVENT_ID);
      assert.equal(transport.transport.mode, "none");

      const linkedEvent = await linkedEventsProvider.handle(context, {
        action: "upsert-linked-event",
        payload: {
          sourceModule: "chequebook",
          sourceEntityType: "recurring-rule",
          sourceEntityId: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
          title: "Linked household bill",
          date: "2026-10-01",
          color: "red",
          notes: "Calendar broker conformance",
          recurrence: {
            frequency: "monthly",
            interval: 1,
            until: "2027-09-30",
          },
        },
      });
      assert.match(linkedEvent.eventId, /^[0-9a-f-]{36}$/);
      const linkedEventRead = await app.inject({
        method: "GET",
        url: `/api/v1/modules/calendar/events/${linkedEvent.eventId}`,
        headers,
      });
      assert.equal(linkedEventRead.statusCode, 200);
      assert.equal(linkedEventRead.json().data.title, "Linked household bill");
      assert.equal(
        linkedEventRead.json().data.recurrence.frequency,
        "monthly",
      );
      const linkedEventRemoval = await linkedEventsProvider.handle(context, {
        action: "remove-linked-event",
        payload: {
          sourceModule: "chequebook",
          sourceEntityType: "recurring-rule",
          sourceEntityId: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
        },
      });
      assert.equal(linkedEventRemoval.removed, true);
      const removedLinkedEventRead = await app.inject({
        method: "GET",
        url: `/api/v1/modules/calendar/events/${linkedEvent.eventId}`,
        headers,
      });
      assert.equal(removedLinkedEventRead.statusCode, 404);

      const feedCreate = await app.inject({
        method: "POST",
        url: "/api/v1/modules/calendar/ics/feeds",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        payload: { label: "Conformance feed" },
      });
      assert.equal(feedCreate.statusCode, 200);
      const firstFeedUrl = feedCreate.json().data.feedUrl;
      assert.equal(typeof firstFeedUrl, "string");
      const firstFeedPath = new URL(firstFeedUrl).pathname;
      const firstFeed = await app.inject({
        method: "GET",
        url: firstFeedPath,
      });
      assert.equal(firstFeed.statusCode, 200);
      assert.match(firstFeed.body, /BEGIN:VCALENDAR/);
      assert.match(firstFeed.body, /Reminder proof event/);

      const feeds = await app.inject({
        method: "GET",
        url: "/api/v1/modules/calendar/ics/feeds",
        headers,
      });
      assert.equal(feeds.statusCode, 200);
      const feedId = feeds.json().data[0].id;
      const regenerated = await app.inject({
        method: "POST",
        url:
          `/api/v1/modules/calendar/ics/feeds/${feedId}/regenerate`,
        headers,
      });
      assert.equal(regenerated.statusCode, 200);
      const secondFeedPath = new URL(
        regenerated.json().data.feedUrl,
      ).pathname;
      assert.notEqual(secondFeedPath, firstFeedPath);
      assert.equal(
        (
          await app.inject({
            method: "GET",
            url: firstFeedPath,
          })
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await app.inject({
            method: "GET",
            url: secondFeedPath,
          })
        ).statusCode,
        200,
      );
      const revoked = await app.inject({
        method: "DELETE",
        url: `/api/v1/modules/calendar/ics/feeds/${feedId}`,
        headers,
      });
      assert.equal(revoked.statusCode, 200);
      assert.equal(
        (
          await app.inject({
            method: "GET",
            url: secondFeedPath,
          })
        ).statusCode,
        404,
      );

      const appleConnect = await app.inject({
        method: "POST",
        url: "/api/v1/modules/calendar/external/apple/connect",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        payload: {
          username: "calendar@example.test",
          password: "app-specific-secret",
          calendarUrl:
            "https://caldav.icloud.com/test/calendar/",
          label: "Apple Test Calendar",
        },
      });
      assert.equal(
        appleConnect.statusCode,
        200,
        appleConnect.body,
      );
      const connectionId = appleConnect.json().data.id;
      assert.equal(typeof connectionId, "string");

      const secretRows = await serviceClient.query(
        `SELECT ciphertext, iv, auth_tag AS "authTag"
         FROM core.module_secrets
         WHERE household_id = $1::uuid`,
        [HOUSEHOLD_ID],
      );
      assert.equal(secretRows.rows.length, 1);
      assert.notEqual(
        secretRows.rows[0].ciphertext,
        "app-specific-secret",
      );
      assert.equal(
        String(secretRows.rows[0].ciphertext).includes(
          "app-specific-secret",
        ),
        false,
      );

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (_input, init) => {
        assert.equal(init?.method, "REPORT");
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/test/event.ics</d:href>
    <d:propstat><d:prop>
      <d:getetag>"apple-etag-1"</d:getetag>
      <c:calendar-data><![CDATA[BEGIN:VCALENDAR
BEGIN:VEVENT
UID:apple-proof-event
DTSTART:20260922T180000Z
DTEND:20260922T190000Z
SUMMARY:Apple imported event
LOCATION:School
LAST-MODIFIED:20260919T220000Z
END:VEVENT
END:VCALENDAR]]></c:calendar-data>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`,
          {
            status: 207,
            headers: { "content-type": "application/xml" },
          },
        );
      };
      try {
        const syncExternal = await app.inject({
          method: "POST",
          url:
            `/api/v1/modules/calendar/external/connections/${connectionId}/sync`,
          headers,
        });
        assert.equal(syncExternal.statusCode, 200);
      } finally {
        globalThis.fetch = originalFetch;
      }

      const allEvents = await app.inject({
        method: "GET",
        url: "/api/v1/modules/calendar/events",
        headers,
      });
      assert.equal(allEvents.statusCode, 200);
      const externalEvent = allEvents
        .json()
        .data.find((item) => item.title === "Apple imported event");
      assert(externalEvent);
      assert.equal(externalEvent.source, "external");
      assert.equal(externalEvent.externalProvider, "apple");

      const rejectedExternalEdit =
        await moduleSync.applyMutation(context, {
          clientMutationId:
            "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          moduleKey: "calendar",
          entityType: "event",
          entityId: externalEvent.id,
          operation: "update",
          baseRevision: BigInt(externalEvent.revision),
          payload: { title: "Must remain read-only" },
        });
      assert.equal(rejectedExternalEdit.status, "rejected");
      assert.equal(
        rejectedExternalEdit.errorCode,
        "CALENDAR_EXTERNAL_EVENT_READ_ONLY",
      );

      const disconnect = await app.inject({
        method: "DELETE",
        url:
          `/api/v1/modules/calendar/external/connections/${connectionId}`,
        headers,
      });
      assert.equal(disconnect.statusCode, 200);
      const remainingSecrets = await serviceClient.query(
        `SELECT count(*)::int AS count
         FROM core.module_secrets
         WHERE household_id = $1::uuid`,
        [HOUSEHOLD_ID],
      );
      assert.equal(remainingSecrets.rows[0].count, 0);
    } finally {
      await serviceClient.end();
    }

    await app.close();

    const webModule = await import(
      pathToFileURL(
        join(calendarDirectory, "dist/web.js"),
      ).href
    );
    const definition = webModule.createHomiWebModule({
      authSubject: USER_ID,
      householdId: HOUSEHOLD_ID,
      clientId: CLIENT_ID,
      locale: "en-CA",
      timeZone: "America/Toronto",
      online: true,
    });
    assert.equal(definition.moduleKey, "calendar");
    assert.ok(definition.pages.calendar);
    assert.deepEqual(
      Object.keys(definition.familyBoard ?? {}).sort(),
      ["coming-week", "mini-month", "today-count"],
    );
    assert.equal(definition.sync?.mutationAdapters?.length, 3);
    assert.equal(definition.sync?.changeHandlers?.length, 3);
  } finally {
    await database.close();
  }

  const finalOwner = new Client({ connectionString: migratorUrl });
  await finalOwner.connect();
  try {
    await finalOwner.query("SET ROLE homi_owner");
    const registry = await finalOwner.query(
      `SELECT state, current_version AS "currentVersion"
       FROM core.modules
       WHERE module_key = 'calendar'`,
    );
    assert.deepEqual(registry.rows, [
      { state: "installed", currentVersion: "0.6.7" },
    ]);

    const preserved = await finalOwner.query(
      `SELECT
         s.state,
         s.revision::text AS "settingsRevision",
         e.title,
         e.revision::text AS "eventRevision",
         e.description
       FROM mod_calendar.settings AS s
       JOIN mod_calendar.events AS e
         ON e.household_id = s.household_id
       WHERE s.household_id = $1::uuid
         AND e.id = $2::uuid`,
      [HOUSEHOLD_ID, EVENT_ID],
    );
    assert.deepEqual(preserved.rows, [
      {
        state: "configured",
        settingsRevision: "4",
        title: "Preserved family event",
        eventRevision: "7",
        description: "Legacy 0.4 data",
      },
    ]);
    await finalOwner.query("RESET ROLE");
  } finally {
    await finalOwner.end();
  }

  console.log(
    "PASS_60_CALENDAR_SDK_CONFORMANCE " +
      "legacy-adoption=yes data-preserved=yes " +
      "managed-runtime=yes managed-precedence=yes household-people-capability=yes " +
      "sync-entities=5 broker-providers=3 linked-events-provider=yes jobs=2 " +
      "reminders=yes mutation-side-effects=atomic encrypted-secrets=yes external-sync=yes " +
      "ics-rotation=yes external-readonly=yes " +
      "external-migration=yes event-colors=yes legacy-schema-reconciled=yes all-day=yes " +
      "home-cards=3 homi-web-contract=yes",
  );
} finally {
  await rm(installRoot, { recursive: true, force: true });
}
