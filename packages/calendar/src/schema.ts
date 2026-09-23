import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const calendarSchema = pgSchema("mod_calendar");

export const calendarCalendars = calendarSchema.table(
  "calendars",
  {
    id: uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey(),
    householdId: uuid("household_id").notNull(),
    name: text("name").notNull(),
    color: text("color").$type<import('./settings.js').CalendarColor>().notNull(),
    kind: text("kind").$type<'local' | 'external'>().notNull().default('local'),
    revision: bigint("revision", { mode: "bigint" }).notNull().default(sql`1`),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, precision: 3 }),
  },
  (table) => [
    index("ix_calendar_calendars_household").on(table.householdId),
    check("ck_calendar_calendars_name", sql`length(trim(${table.name})) between 1 and 200`),
    check("ck_calendar_calendars_kind", sql`${table.kind} in ('local', 'external')`),
    check("ck_calendar_calendars_color", sql`${table.color} in ('red','orange','yellow','lime','green','dark green','aqua','cyan','blue','navy','purple','violet','pink','magenta','brown','black')`),
    check("ck_calendar_calendars_revision", sql`${table.revision} >= 1`),
  ],
);

export const calendarEvents = calendarSchema.table(
  "events",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id").notNull(),
    calendarId: uuid("calendar_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    color: text("color").$type<import('./settings.js').CalendarColor>().notNull().default('blue'),
    startsAt: timestamp("starts_at", { withTimezone: true, precision: 3 }),
    endsAt: timestamp("ends_at", { withTimezone: true, precision: 3 }),
    allDay: boolean("all_day").notNull().default(false),
    timeZone: text("time_zone").notNull(),
    startDate: date("start_date"),
    endDateExclusive: date("end_date_exclusive"),
    location: text("location"),
    notes: text("notes"),
    recurrence: jsonb("recurrence").$type<import("./types.js").CalendarRecurrenceRule | null>().default(null),
    recurrenceOverrides: jsonb("recurrence_overrides").$type<readonly import("./types.js").CalendarOccurrenceOverride[]>().notNull().default(sql`'[]'::jsonb`),
    personIds: uuid("person_ids").array().notNull().default(sql`'{}'::uuid[]`),
    reminderMinutes: integer("reminder_minutes").array().notNull().default(sql`'{}'::integer[]`),
    transport: jsonb("transport").$type<import("./types.js").CalendarTransportContext>().notNull().default(sql`'{"mode":"none","pickupPersonId":null,"dropoffPersonId":null,"notes":null}'::jsonb`),
    revision: bigint("revision", { mode: "bigint" }).notNull().default(sql`1`),
    createdByUserId: uuid("created_by_user_id").notNull(),
    updatedByUserId: uuid("updated_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, precision: 3 }),
  },
  (table) => [
    index("ix_calendar_events_household_start").on(table.householdId, table.startsAt),
    index("ix_calendar_events_household_calendar_start").on(table.householdId, table.calendarId, table.startsAt),
    check("ck_calendar_events_color", sql`${table.color} in ('red','orange','yellow','lime','green','dark green','aqua','cyan','blue','navy','purple','violet','pink','magenta','brown','black')`),
    check("ck_calendar_events_range", sql`${table.endsAt} > ${table.startsAt}`),
    check("ck_calendar_events_date_shape", sql`(
      (
        ${table.allDay}
        and ${table.startDate} is not null
        and ${table.endDateExclusive} is not null
        and ${table.endDateExclusive} > ${table.startDate}
        and ${table.startsAt} is null
        and ${table.endsAt} is null
      )
      or
      (
        not ${table.allDay}
        and ${table.startsAt} is not null
        and ${table.endsAt} is not null
        and ${table.endsAt} > ${table.startsAt}
        and ${table.startDate} is null
        and ${table.endDateExclusive} is null
      )
    )`),
    check("ck_calendar_events_revision", sql`${table.revision} >= 1`),
  ],
);

export const calendarSettings = calendarSchema.table('settings', {
  householdId: uuid('household_id').primaryKey(),
  state: text('state').$type<'unconfigured' | 'configured'>().notNull(),
  defaultView: text('default_view').$type<import('./settings.js').CalendarViewName>().notNull(),
  weekStart: text('week_start').$type<'sunday' | 'monday'>().notNull(),
  timeZone: text('time_zone').notNull(),
  defaultReminder: text('default_reminder').$type<'none' | '30m' | '1h'>().notNull(),
  defaultCalendarId: uuid('default_calendar_id').notNull(),
  revision: bigint('revision', { mode: 'bigint' }).notNull(),
}, table => [
  check('ck_calendar_settings_state', sql`${table.state} in ('unconfigured', 'configured')`),
  check('ck_calendar_settings_view', sql`${table.defaultView} in ('day', 'week', 'month', 'upcoming')`),
  check('ck_calendar_settings_week', sql`${table.weekStart} in ('sunday', 'monday')`),
  check('ck_calendar_settings_reminder', sql`${table.defaultReminder} in ('none', '30m', '1h')`),
  check('ck_calendar_settings_revision', sql`${table.revision} >= 1`),
]);
