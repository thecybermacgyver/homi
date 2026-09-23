import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import {
  HOMI_MODULE_API_VERSION,
  defineHomiServerModule,
  type HomiBrokerInvocation,
  type HomiHouseholdPerson,
  type HomiModuleDatabase,
  type HomiModuleJobsCapability,
  type HomiModuleMutationServices,
  type HomiModuleServerMutationInput,
  type HomiModuleServerMutationResult,
  type HomiRequestContext,
  type HomiServerModuleHostContext,
} from "@homi/module-sdk";
import { CALENDAR_MODULE_KEY } from "./constants.js";
import {
  CALENDAR_COLORS,
  type CalendarColor,
} from "./settings.js";
import {
  parseEventPayload,
} from "./event-validation.js";
import {
  expandCalendarEvents,
  recurrenceOccursOn,
} from "./recurrence.js";
import {
  createOAuthRequest,
  discoverAppleCalendars,
  exchangeOAuthCode,
  fetchExternalEvents,
  providerConfigured,
  type CalendarExternalProvider,
  type CalendarExternalEvent,
} from "./providers.js";
import type {
  CalendarEvent,
  CalendarEventPayload,
  CalendarTransportContext,
} from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface EventRow extends Record<string, unknown> {
  id: string;
  householdId: string;
  calendarId: string;
  color: CalendarColor;
  title: string;
  description: string | null;
  allDay: boolean;
  timeZone: string;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  startDate: string | null;
  endDateExclusive: string | null;
  location: string | null;
  notes: string | null;
  recurrence: CalendarEvent["recurrence"];
  recurrenceOverrides: CalendarEvent["recurrenceOverrides"];
  personIds: string[];
  reminderMinutes: number[];
  transport: CalendarTransportContext;
  externalConnectionId: string | null;
  externalProvider: CalendarExternalProvider | null;
  remoteEventId: string | null;
  remoteEtag: string | null;
  remoteUpdatedAt: Date | string | null;
  revision: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}

interface SettingsRow extends Record<string, unknown> {
  state: string;
  defaultView: string;
  weekStart: string;
  timeZone: string;
  defaultReminder: string;
  defaultCalendarId: string;
  revision: string;
}

interface CalendarRow extends Record<string, unknown> {
  id: string;
  householdId: string;
  name: string;
  color: CalendarColor;
  kind: string;
  revision: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface ExternalConnectionRow extends Record<string, unknown> {
  id: string;
  householdId: string;
  calendarId: string;
  provider: CalendarExternalProvider;
  accountLabel: string;
  remoteCalendarId: string;
  endpointUrl: string | null;
  status: string;
  syncCursor: string | null;
  lastSyncedAt: Date | string | null;
  lastError: string | null;
  revision: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface OAuthStateRow extends Record<string, unknown> {
  id: string;
  provider: "google" | "outlook";
  householdId: string;
  context: HomiRequestContext;
  codeVerifier: string;
  redirectUri: string;
  returnTo: string;
  expiresAt: Date | string;
  usedAt: Date | string | null;
}

interface IcsFeedRow extends Record<string, unknown> {
  id: string;
  householdId: string;
  label: string;
  createdAt: Date | string;
  revokedAt: Date | string | null;
}

function httpError(
  statusCode: number,
  code: string,
  message: string,
): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & {
    statusCode: number;
    code: string;
  };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function headersFor(
  request: FastifyRequest,
): Record<string, string | string[] | undefined> {
  return request.headers as Record<
    string,
    string | string[] | undefined
  >;
}

async function requestContext(
  host: HomiServerModuleHostContext,
  request: FastifyRequest,
): Promise<HomiRequestContext> {
  const context = await host.resolveContext({
    id: request.id,
    headers: headersFor(request),
  });
  await host.requireEnabled(CALENDAR_MODULE_KEY, context);
  return context;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function calendarState(row: CalendarRow) {
  return Object.freeze({
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    color: row.color,
    kind: row.kind,
    revision: row.revision,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  });
}

function validCalendarColor(value: unknown): value is CalendarColor {
  return typeof value === "string" &&
    Object.hasOwn(CALENDAR_COLORS, value);
}

function parseCalendarCreate(body: unknown): {
  id: string;
  name: string;
  color: CalendarColor;
} {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw httpError(400, "CALENDAR_LAYER_INVALID", "A JSON object is required.");
  }
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !["id", "name", "color"].includes(key)) ||
    typeof input.id !== "string" || !UUID.test(input.id) ||
    typeof input.name !== "string" ||
    input.name.trim().length < 1 || input.name.trim().length > 200 ||
    !validCalendarColor(input.color)
  ) {
    throw httpError(400, "CALENDAR_LAYER_INVALID", "Calendar name, color, and ID are invalid.");
  }
  return { id: input.id, name: input.name.trim(), color: input.color };
}

function parseCalendarUpdate(body: unknown): {
  baseRevision: string;
  name: string;
  color: CalendarColor;
} {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw httpError(400, "CALENDAR_LAYER_INVALID", "A JSON object is required.");
  }
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !["baseRevision", "name", "color"].includes(key)) ||
    typeof input.baseRevision !== "string" || !/^[1-9][0-9]*$/.test(input.baseRevision) ||
    typeof input.name !== "string" || input.name.trim().length < 1 || input.name.trim().length > 200 ||
    !validCalendarColor(input.color)
  ) {
    throw httpError(400, "CALENDAR_LAYER_INVALID", "Calendar update is invalid.");
  }
  return { baseRevision: input.baseRevision, name: input.name.trim(), color: input.color };
}

function parseCalendarDelete(body: unknown): { baseRevision: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw httpError(400, "CALENDAR_LAYER_INVALID", "A JSON object is required.");
  }
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).length !== 1 ||
    typeof input.baseRevision !== "string" ||
    !/^[1-9][0-9]*$/.test(input.baseRevision)
  ) {
    throw httpError(400, "CALENDAR_LAYER_INVALID", "Calendar delete revision is invalid.");
  }
  return { baseRevision: input.baseRevision };
}

function eventState(row: EventRow): CalendarEvent {
  return Object.freeze({
    id: row.id,
    householdId: row.householdId,
    calendarId: row.calendarId,
    color: row.color,
    title: row.title,
    description: row.description,
    allDay: row.allDay,
    timeZone: row.timeZone,
    startsAt: row.allDay ? null : iso(row.startsAt),
    endsAt: row.allDay ? null : iso(row.endsAt),
    startDate: row.allDay ? row.startDate : null,
    endDateExclusive: row.allDay
      ? row.endDateExclusive
      : null,
    location: row.location,
    notes: row.notes,
    recurrence: row.recurrence,
    recurrenceOverrides: row.recurrenceOverrides,
    personIds: Object.freeze([...row.personIds]),
    reminderMinutes: Object.freeze([
      ...row.reminderMinutes,
    ]),
    transport: Object.freeze({ ...row.transport }),
    source: row.externalConnectionId ? "external" : "local",
    externalProvider: row.externalProvider,
    externalConnectionId: row.externalConnectionId,
    remoteEventId: row.remoteEventId,
    revision: row.revision,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  });
}

const EVENT_SELECT = `
  SELECT
    id::text AS id,
    household_id::text AS "householdId",
    calendar_id::text AS "calendarId",
    color,
    title,
    description,
    all_day AS "allDay",
    time_zone AS "timeZone",
    starts_at AS "startsAt",
    ends_at AS "endsAt",
    start_date::text AS "startDate",
    end_date_exclusive::text AS "endDateExclusive",
    location,
    notes,
    recurrence,
    recurrence_overrides AS "recurrenceOverrides",
    person_ids::text[] AS "personIds",
    reminder_minutes AS "reminderMinutes",
    transport,
    external_connection_id::text AS "externalConnectionId",
    (
      SELECT ec.provider
      FROM mod_calendar.external_connections AS ec
      WHERE ec.id = external_connection_id
    ) AS "externalProvider",
    remote_event_id AS "remoteEventId",
    remote_etag AS "remoteEtag",
    remote_updated_at AS "remoteUpdatedAt",
    revision::text AS revision,
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    deleted_at AS "deletedAt"
  FROM mod_calendar.events
`;

async function findEvent(
  database: HomiModuleDatabase,
  context: HomiRequestContext,
  eventId: string,
  forUpdate = false,
): Promise<EventRow | null> {
  const result = await database.query<EventRow>(
    `${EVENT_SELECT}
     WHERE household_id = $1::uuid
       AND id = $2::uuid
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [context.householdId, eventId],
  );
  return result.rows[0] ?? null;
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", {
      timeZone: value,
    }).format();
    return true;
  } catch {
    return false;
  }
}

function optionalText(
  value: unknown,
  field: string,
  maximum = 2000,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw httpError(400, "CALENDAR_EVENT_INVALID", `${field} must be text.`);
  }
  const text = value.trim();
  if (text.length > maximum) {
    throw httpError(400, "CALENDAR_EVENT_INVALID", `${field} is too long.`);
  }
  return text || null;
}

function parsePayload(
  payload: Record<string, unknown>,
  current?: EventRow,
): Required<Pick<CalendarEventPayload,
  "calendarId" | "title" | "allDay" | "timeZone"
>> & CalendarEventPayload {
  const calendarId =
    typeof payload.calendarId === "string"
      ? payload.calendarId
      : current?.calendarId;
  const title =
    typeof payload.title === "string"
      ? payload.title.trim()
      : current?.title;
  const color = Object.hasOwn(payload, "color")
    ? payload.color
    : current?.color;
  if (color !== undefined && !validCalendarColor(color)) {
    throw httpError(400, "CALENDAR_EVENT_COLOR_INVALID", "Calendar event color is invalid.");
  }
  const allDay =
    typeof payload.allDay === "boolean"
      ? payload.allDay
      : current?.allDay;
  const timeZone =
    typeof payload.timeZone === "string"
      ? payload.timeZone
      : current?.timeZone;

  if (
    !calendarId ||
    !UUID.test(calendarId) ||
    !title ||
    title.length > 200 ||
    allDay === undefined ||
    !timeZone ||
    !validTimeZone(timeZone)
  ) {
    throw httpError(
      400,
      "CALENDAR_EVENT_INVALID",
      "Calendar, title, event type, and a valid time zone are required.",
    );
  }

  const description = Object.hasOwn(payload, "description")
    ? optionalText(payload.description, "description", 5000)
    : current?.description ?? null;
  const location = Object.hasOwn(payload, "location")
    ? optionalText(payload.location, "location", 500)
    : current?.location ?? null;
  const notes = Object.hasOwn(payload, "notes")
    ? optionalText(payload.notes, "notes", 5000)
    : current?.notes ?? null;

  const personIds = Object.hasOwn(payload, "personIds")
    ? payload.personIds
    : current?.personIds ?? [];
  if (
    !Array.isArray(personIds) ||
    personIds.some(
      (value) => typeof value !== "string" || !UUID.test(value),
    )
  ) {
    throw httpError(
      400,
      "CALENDAR_PERSON_INVALID",
      "Calendar people must be valid household person IDs.",
    );
  }

  const reminderMinutes = Object.hasOwn(
    payload,
    "reminderMinutes",
  )
    ? payload.reminderMinutes
    : current?.reminderMinutes ?? [];
  if (
    !Array.isArray(reminderMinutes) ||
    reminderMinutes.some(
      (value) =>
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > 525600,
    )
  ) {
    throw httpError(
      400,
      "CALENDAR_REMINDER_INVALID",
      "Reminder minutes must be non-negative integers.",
    );
  }

  const recurrence = Object.hasOwn(payload, "recurrence")
    ? payload.recurrence ?? null
    : current?.recurrence ?? null;
  const recurrenceOverrides = Object.hasOwn(
    payload,
    "recurrenceOverrides",
  )
    ? payload.recurrenceOverrides ?? []
    : current?.recurrenceOverrides ?? [];
  if (
    recurrence !== null &&
    (typeof recurrence !== "object" || Array.isArray(recurrence))
  ) {
    throw httpError(400, "CALENDAR_RECURRENCE_INVALID", "Recurrence is invalid.");
  }
  if (!Array.isArray(recurrenceOverrides)) {
    throw httpError(400, "CALENDAR_RECURRENCE_INVALID", "Recurrence overrides are invalid.");
  }

  const rawTransport = Object.hasOwn(payload, "transport")
    ? payload.transport
    : current?.transport ?? {
        mode: "none",
        pickupPersonId: null,
        dropoffPersonId: null,
        notes: null,
      };
  if (
    typeof rawTransport !== "object" ||
    rawTransport === null ||
    Array.isArray(rawTransport)
  ) {
    throw httpError(400, "CALENDAR_TRANSPORT_INVALID", "Transportation details are invalid.");
  }
  const transport = rawTransport as CalendarTransportContext;

  if (allDay) {
    const startDate =
      typeof payload.startDate === "string"
        ? payload.startDate
        : current?.startDate;
    const endDateExclusive =
      typeof payload.endDateExclusive === "string"
        ? payload.endDateExclusive
        : current?.endDateExclusive;
    if (
      !startDate ||
      !endDateExclusive ||
      !DATE.test(startDate) ||
      !DATE.test(endDateExclusive) ||
      endDateExclusive <= startDate
    ) {
      throw httpError(
        400,
        "CALENDAR_INVALID_ALL_DAY_RANGE",
        "All-day events require a start date and a later end date.",
      );
    }
    return {
      calendarId,
      ...(color === undefined ? {} : { color }),
      title,
      description,
      allDay,
      timeZone,
      startsAt: null,
      endsAt: null,
      startDate,
      endDateExclusive,
      location,
      notes,
      recurrence: recurrence as CalendarEvent["recurrence"],
      recurrenceOverrides: recurrenceOverrides as CalendarEvent["recurrenceOverrides"],
      personIds: personIds as string[],
      reminderMinutes: reminderMinutes as number[],
      transport,
    };
  }

  const startsAt =
    typeof payload.startsAt === "string"
      ? payload.startsAt
      : current && !current.allDay
        ? iso(current.startsAt)
        : null;
  const endsAt =
    typeof payload.endsAt === "string"
      ? payload.endsAt
      : current && !current.allDay
        ? iso(current.endsAt)
        : null;
  if (!startsAt || !endsAt) {
    throw httpError(
      400,
      "CALENDAR_INVALID_TIMED_RANGE",
      "Timed events require start and end times.",
    );
  }
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end <= start
  ) {
    throw httpError(
      400,
      "CALENDAR_INVALID_TIMED_RANGE",
      "Event end time must be after its start time.",
    );
  }

  return {
    calendarId,
    ...(color === undefined ? {} : { color }),
    title,
    description,
    allDay,
    timeZone,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    startDate: null,
    endDateExclusive: null,
    location,
    notes,
    recurrence: recurrence as CalendarEvent["recurrence"],
    recurrenceOverrides: recurrenceOverrides as CalendarEvent["recurrenceOverrides"],
    personIds: personIds as string[],
    reminderMinutes: reminderMinutes as number[],
    transport,
  };
}

function localDateForIso(isoValue: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(isoValue));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function validateRecurrence(
  state: ReturnType<typeof parsePayload>,
): void {
  const recurrence = state.recurrence ?? null;
  if (recurrence === null) {
    if ((state.recurrenceOverrides ?? []).length > 0) {
      throw httpError(
        400,
        "CALENDAR_RECURRENCE_OVERRIDES_WITHOUT_SERIES",
        "Occurrence overrides require a recurring event.",
      );
    }
    return;
  }
  const anchor = state.allDay
    ? state.startDate!
    : localDateForIso(state.startsAt!, state.timeZone);
  if (
    recurrence.endDate !== null &&
    recurrence.endDate < anchor
  ) {
    throw httpError(
      400,
      "CALENDAR_RECURRENCE_END_BEFORE_START",
      "Recurrence end date cannot be before the first occurrence.",
    );
  }
  if (!recurrenceOccursOn(anchor, recurrence, anchor)) {
    throw httpError(
      400,
      "CALENDAR_RECURRENCE_EXCLUDES_START",
      "The recurrence rule must include the event's first occurrence.",
    );
  }
  for (const override of state.recurrenceOverrides ?? []) {
    if (
      !recurrenceOccursOn(
        anchor,
        recurrence,
        override.occurrenceDate,
      )
    ) {
      throw httpError(
        400,
        "CALENDAR_RECURRENCE_OVERRIDE_INVALID",
        "Occurrence overrides must target dates produced by the recurrence rule.",
      );
    }
  }
}

async function requireCalendar(
  database: HomiModuleDatabase,
  context: HomiRequestContext,
  calendarId: string,
): Promise<{ color: CalendarColor }> {
  const result = await database.query<{ color: CalendarColor }>(
    `SELECT color
     FROM mod_calendar.calendars
     WHERE household_id = $1::uuid
       AND id = $2::uuid
       AND deleted_at IS NULL
     LIMIT 1`,
    [context.householdId, calendarId],
  );
  const row = result.rows[0];
  if (!row || !validCalendarColor(row.color)) {
    throw httpError(
      400,
      "CALENDAR_LAYER_NOT_FOUND",
      "The selected calendar is not active in this household.",
    );
  }
  return row;
}

async function requirePeople(
  host: HomiServerModuleHostContext,
  databaseForPeople: HomiModuleDatabase,
  context: HomiRequestContext,
  payload: ReturnType<typeof parsePayload>,
): Promise<void> {
  const capability = host.householdPeople;
  if (!capability) {
    throw new Error(
      "Calendar requires the declared household-people Core capability.",
    );
  }
  const people = await capability.listActive(context);
  const active = new Set(people.map((person) => person.id));
  const ids = new Set(payload.personIds ?? []);
  const calendarIds = new Set<string>([payload.calendarId]);
  if (payload.transport?.pickupPersonId) {
    ids.add(payload.transport.pickupPersonId);
  }
  if (payload.transport?.dropoffPersonId) {
    ids.add(payload.transport.dropoffPersonId);
  }
  for (const override of payload.recurrenceOverrides ?? []) {
    const replacement = override.replacement;
    if (!replacement) continue;
    calendarIds.add(replacement.calendarId);
    for (const id of replacement.personIds) ids.add(id);
    if (replacement.transport.pickupPersonId) {
      ids.add(replacement.transport.pickupPersonId);
    }
    if (replacement.transport.dropoffPersonId) {
      ids.add(replacement.transport.dropoffPersonId);
    }
  }
  for (const calendarId of calendarIds) {
    await requireCalendar(databaseForPeople!, context, calendarId);
  }
  for (const id of ids) {
    if (!active.has(id)) {
      throw httpError(
        400,
        "CALENDAR_PERSON_INVALID",
        "People and transportation assignments must use active household people.",
      );
    }
  }
}

function initialCalendarId(householdId: string): string {
  const chars = createHash("sha256")
    .update(`homi:calendar:initial:${householdId}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  chars[12] = "4";
  const variant = Number.parseInt(chars[16] ?? "0", 16) & 0x3;
  chars[16] = ["8", "9", "a", "b"][variant]!;
  const hex = chars.join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

async function ensureInitialCalendar(
  database: HomiModuleDatabase,
  context: HomiRequestContext,
): Promise<CalendarRow> {
  const existing = await database.query<CalendarRow>(
    `SELECT
       id::text AS id,
       household_id::text AS "householdId",
       name,
       color,
       kind,
       revision::text AS revision,
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM mod_calendar.calendars
     WHERE household_id = $1::uuid
       AND deleted_at IS NULL
     ORDER BY created_at, id
     LIMIT 1`,
    [context.householdId],
  );
  if (existing.rows[0]) return existing.rows[0];

  const id = initialCalendarId(context.householdId);
  const created = await database.query<CalendarRow>(
    `INSERT INTO mod_calendar.calendars (
       id,
       household_id,
       name,
       color,
       kind,
       revision
     )
     VALUES ($1::uuid, $2::uuid, 'Household', 'blue', 'local', 1)
     ON CONFLICT (id) DO NOTHING
     RETURNING
       id::text AS id,
       household_id::text AS "householdId",
       name,
       color,
       kind,
       revision::text AS revision,
       created_at AS "createdAt",
       updated_at AS "updatedAt"`,
    [id, context.householdId],
  );
  if (created.rows[0]) return created.rows[0];

  const concurrent = await database.query<CalendarRow>(
    `SELECT
       id::text AS id,
       household_id::text AS "householdId",
       name,
       color,
       kind,
       revision::text AS revision,
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM mod_calendar.calendars
     WHERE household_id = $1::uuid
       AND id = $2::uuid
       AND deleted_at IS NULL
     LIMIT 1`,
    [context.householdId, id],
  );
  const row = concurrent.rows[0];
  if (!row) throw new Error("Calendar initialization returned no row.");
  return row;
}

function zonedMidnightInstant(date: string, timeZone: string): Date {
  const desired = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    0,
    0,
  );
  let guess = desired;
  for (let index = 0; index < 4; index += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    const observed = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
    );
    const correction = desired - observed;
    if (correction === 0) break;
    guess += correction;
  }
  return new Date(guess);
}

function utcDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

async function scheduleEventReminders(
  jobs: HomiModuleJobsCapability | undefined,
  context: HomiRequestContext,
  event: CalendarEvent,
): Promise<void> {
  if (!jobs || event.reminderMinutes.length === 0) return;

  const now = new Date();
  const rangeStart = utcDateKey(new Date(now.getTime() - 86_400_000));
  const rangeEnd = utcDateKey(
    new Date(now.getTime() + 400 * 86_400_000),
  );
  const occurrences = expandCalendarEvents(
    [event],
    rangeStart,
    rangeEnd,
  );

  for (const occurrence of occurrences) {
    const startsAt = occurrence.event.allDay
      ? zonedMidnightInstant(
          occurrence.occurrenceDate,
          occurrence.event.timeZone,
        )
      : new Date(occurrence.event.startsAt!);
    for (const offsetMinutes of occurrence.event.reminderMinutes) {
      const runAt = new Date(
        startsAt.getTime() - offsetMinutes * 60_000,
      );
      if (runAt <= now) continue;
      await jobs.schedule(context, {
        jobType: "event-reminder",
        runAt: runAt.toISOString(),
        dedupeKey:
          `event-reminder:${event.id}:${event.revision}:` +
          `${occurrence.occurrenceDate}:${offsetMinutes}`,
        payload: {
          eventId: event.id,
          eventRevision: event.revision,
          occurrenceDate: occurrence.occurrenceDate,
          offsetMinutes,
        },
      });
    }
  }
}

async function deliverEventReminder(
  host: HomiServerModuleHostContext,
  database: HomiModuleDatabase,
  context: HomiRequestContext,
  payload: Readonly<Record<string, unknown>>,
): Promise<void> {
  const notifications = host.notifications;
  if (!notifications) {
    throw new Error("Calendar requires the notifications Core capability.");
  }
  const eventId = payload.eventId;
  const eventRevision = payload.eventRevision;
  const occurrenceDate = payload.occurrenceDate;
  const offsetMinutes = payload.offsetMinutes;
  if (
    typeof eventId !== "string" ||
    !UUID.test(eventId) ||
    typeof eventRevision !== "string" ||
    !/^[1-9][0-9]*$/.test(eventRevision) ||
    typeof occurrenceDate !== "string" ||
    !DATE.test(occurrenceDate) ||
    !Number.isSafeInteger(offsetMinutes) ||
    Number(offsetMinutes) <= 0
  ) {
    throw new Error("Calendar reminder job payload is invalid.");
  }
  const row = await findEvent(database, context, eventId);
  if (
    !row ||
    row.deletedAt !== null ||
    row.revision !== eventRevision
  ) {
    return;
  }
  const event = eventState(row);
  if (!event.reminderMinutes.includes(Number(offsetMinutes))) {
    return;
  }
  const occurrence = expandCalendarEvents(
    [event],
    occurrenceDate,
    utcDateKey(
      new Date(
        Date.parse(`${occurrenceDate}T00:00:00Z`) + 86_400_000,
      ),
    ),
  ).find((item) => item.occurrenceDate === occurrenceDate);
  if (!occurrence) return;

  await notifications.notify(context, {
    personIds: occurrence.event.personIds,
    notificationType: "calendar-reminder",
    titleKey: "calendar.reminder.title",
    bodyKey: "calendar.reminder.body",
    arguments: {
      title: occurrence.event.title,
      occurrenceDate,
      offsetMinutes: Number(offsetMinutes),
    },
    data: {
      moduleKey: CALENDAR_MODULE_KEY,
      eventId,
      occurrenceDate,
    },
  });
}

async function applyEventMutation(
  host: HomiServerModuleHostContext,
  context: HomiRequestContext,
  database: HomiModuleDatabase,
  input: HomiModuleServerMutationInput,
  services: HomiModuleMutationServices,
): Promise<HomiModuleServerMutationResult> {
  if (
    input.operation !== "create" &&
    input.operation !== "update" &&
    input.operation !== "delete"
  ) {
    return {
      status: "rejected",
      revision: null,
      errorCode: "CALENDAR_OPERATION_UNSUPPORTED",
      serverState: null,
    };
  }

  const current = await findEvent(
    database,
    context,
    input.entityId,
    true,
  );

  if (input.operation === "create") {
    if (input.baseRevision !== "0") {
      return {
        status: "rejected",
        revision: null,
        errorCode: "CALENDAR_CREATE_INVALID",
        serverState: null,
      };
    }
    if (current) {
      return {
        status: "conflict",
        revision: current.revision,
        errorCode: "REVISION_CONFLICT",
        serverState: eventState(current),
      };
    }

    let state: ReturnType<typeof parsePayload>;
    try {
      const parsed = parseEventPayload(input.payload, "create");
      const initialCalendar = parsed.calendarId
        ? null
        : await ensureInitialCalendar(database, context);
      state = parsePayload({
        ...parsed,
        ...(parsed.calendarId === undefined
          ? { calendarId: initialCalendar!.id }
          : {}),
        ...(parsed.timeZone === undefined
          ? { timeZone: context.timeZone }
          : {}),
        ...(parsed.personIds === undefined ? { personIds: [] } : {}),
        ...(parsed.reminderMinutes === undefined
          ? { reminderMinutes: [] }
          : {}),
        ...(parsed.transport === undefined
          ? {
              transport: {
                mode: "none",
                pickupPersonId: null,
                dropoffPersonId: null,
                notes: null,
              },
            }
          : {}),
      });
      const layer = await requireCalendar(database, context, state.calendarId);
      if (state.color === undefined) {
        state = { ...state, color: layer.color };
      }
      await requirePeople(host, database, context, state);
      validateRecurrence(state);
    } catch (error) {
      return {
        status: "rejected",
        revision: null,
        errorCode:
          typeof error === "object" && error !== null && "code" in error
            ? String((error as { code: unknown }).code)
            : "CALENDAR_CREATE_INVALID",
        serverState: null,
      };
    }

    const result = await database.query<EventRow>(
      `INSERT INTO mod_calendar.events (
         id,
         household_id,
         calendar_id,
         title,
         description,
         all_day,
         time_zone,
         starts_at,
         ends_at,
         start_date,
         end_date_exclusive,
         location,
         notes,
         recurrence,
         recurrence_overrides,
         person_ids,
         reminder_minutes,
         transport,
         color,
         revision,
         created_by_user_id,
         updated_by_user_id
       )
       VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4, $5,
         $6, $7, $8::timestamptz, $9::timestamptz,
         $10::date, $11::date, $12, $13,
         $14::jsonb, $15::jsonb, $16::uuid[],
         $17::integer[], $18::jsonb, $19, 1, $20::uuid, $20::uuid
       )
       RETURNING
         id::text AS id,
         household_id::text AS "householdId",
         calendar_id::text AS "calendarId",
         title,
         description,
         color,
         all_day AS "allDay",
         time_zone AS "timeZone",
         starts_at AS "startsAt",
         ends_at AS "endsAt",
         start_date::text AS "startDate",
         end_date_exclusive::text AS "endDateExclusive",
         location,
         notes,
         recurrence,
         recurrence_overrides AS "recurrenceOverrides",
         person_ids::text[] AS "personIds",
         reminder_minutes AS "reminderMinutes",
         transport,
         revision::text AS revision,
         created_at AS "createdAt",
         updated_at AS "updatedAt",
         deleted_at AS "deletedAt"`,
      [
        input.entityId,
        context.householdId,
        state.calendarId,
        state.title,
        state.description,
        state.allDay,
        state.timeZone,
        state.startsAt,
        state.endsAt,
        state.startDate,
        state.endDateExclusive,
        state.location,
        state.notes,
        state.recurrence === null ? null : JSON.stringify(state.recurrence),
        JSON.stringify(state.recurrenceOverrides ?? []),
        state.personIds ?? [],
        state.reminderMinutes ?? [],
        JSON.stringify(state.transport),
        state.color,
        context.userId,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Calendar event insert returned no row.");
    const saved = eventState(row);
    await scheduleEventReminders(services.jobs, context, saved);
    return {
      status: "applied",
      revision: row.revision,
      serverState: saved,
    };
  }

  if (!current || current.deletedAt !== null) {
    return {
      status: "rejected",
      revision: current?.revision ?? null,
      errorCode: "CALENDAR_EVENT_NOT_FOUND",
      serverState: current ? eventState(current) : null,
    };
  }
  if (current.externalConnectionId !== null) {
    return {
      status: "rejected",
      revision: current.revision,
      errorCode: "CALENDAR_EXTERNAL_EVENT_READ_ONLY",
      serverState: eventState(current),
    };
  }
  if (current.revision !== input.baseRevision) {
    return {
      status: "conflict",
      revision: current.revision,
      errorCode: "REVISION_CONFLICT",
      serverState: eventState(current),
    };
  }

  if (input.operation === "delete") {
    if (Object.keys(input.payload).length !== 0) {
      return {
        status: "rejected",
        revision: current.revision,
        errorCode: "CALENDAR_DELETE_INVALID",
        serverState: eventState(current),
      };
    }
    const result = await database.query<EventRow>(
      `UPDATE mod_calendar.events
       SET
         revision = revision + 1,
         deleted_at = now(),
         updated_at = now(),
         updated_by_user_id = $3::uuid
       WHERE household_id = $1::uuid
         AND id = $2::uuid
       RETURNING
         id::text AS id,
         household_id::text AS "householdId",
         calendar_id::text AS "calendarId",
         title,
         description,
         color,
         all_day AS "allDay",
         time_zone AS "timeZone",
         starts_at AS "startsAt",
         ends_at AS "endsAt",
         start_date::text AS "startDate",
         end_date_exclusive::text AS "endDateExclusive",
         location,
         notes,
         recurrence,
         recurrence_overrides AS "recurrenceOverrides",
         person_ids::text[] AS "personIds",
         reminder_minutes AS "reminderMinutes",
         transport,
         revision::text AS revision,
         created_at AS "createdAt",
         updated_at AS "updatedAt",
         deleted_at AS "deletedAt"`,
      [context.householdId, input.entityId, context.userId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Calendar event delete returned no row.");
    return {
      status: "applied",
      revision: row.revision,
      serverState: eventState(row),
    };
  }

  let state: ReturnType<typeof parsePayload>;
  try {
    const parsed = parseEventPayload(input.payload, "update");
    state = parsePayload({ ...parsed }, current);
    await requireCalendar(database, context, state.calendarId);
    await requirePeople(host, database, context, state);
  } catch (error) {
    return {
      status: "rejected",
      revision: current.revision,
      errorCode:
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "CALENDAR_UPDATE_INVALID",
      serverState: eventState(current),
    };
  }

  const result = await database.query<EventRow>(
    `UPDATE mod_calendar.events
     SET
       calendar_id = $3::uuid,
       title = $4,
       description = $5,
       all_day = $6,
       time_zone = $7,
       starts_at = $8::timestamptz,
       ends_at = $9::timestamptz,
       start_date = $10::date,
       end_date_exclusive = $11::date,
       location = $12,
       notes = $13,
       recurrence = $14::jsonb,
       recurrence_overrides = $15::jsonb,
       person_ids = $16::uuid[],
       reminder_minutes = $17::integer[],
       transport = $18::jsonb,
       color = $19,
       revision = revision + 1,
       updated_at = now(),
       updated_by_user_id = $20::uuid
     WHERE household_id = $1::uuid
       AND id = $2::uuid
     RETURNING
       id::text AS id,
       household_id::text AS "householdId",
       calendar_id::text AS "calendarId",
       title,
       description,
       color,
       all_day AS "allDay",
       time_zone AS "timeZone",
       starts_at AS "startsAt",
       ends_at AS "endsAt",
       start_date::text AS "startDate",
       end_date_exclusive::text AS "endDateExclusive",
       location,
       notes,
       recurrence,
       recurrence_overrides AS "recurrenceOverrides",
       person_ids::text[] AS "personIds",
       reminder_minutes AS "reminderMinutes",
       transport,
       revision::text AS revision,
       created_at AS "createdAt",
       updated_at AS "updatedAt",
       deleted_at AS "deletedAt"`,
    [
      context.householdId,
      input.entityId,
      state.calendarId,
      state.title,
      state.description,
      state.allDay,
      state.timeZone,
      state.startsAt,
      state.endsAt,
      state.startDate,
      state.endDateExclusive,
      state.location,
      state.notes,
      state.recurrence === null ? null : JSON.stringify(state.recurrence),
      JSON.stringify(state.recurrenceOverrides ?? []),
      state.personIds ?? [],
      state.reminderMinutes ?? [],
      JSON.stringify(state.transport),
      state.color,
      context.userId,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Calendar event update returned no row.");
  const saved = eventState(row);
  await scheduleEventReminders(services.jobs, context, saved);
  return {
    status: "applied",
    revision: row.revision,
    serverState: saved,
  };
}

async function findCalendarLayer(
  database: HomiModuleDatabase,
  context: HomiRequestContext,
  calendarId: string,
  forUpdate = false,
): Promise<CalendarRow | null> {
  const result = await database.query<CalendarRow>(
    `SELECT
       id::text AS id,
       household_id::text AS "householdId",
       name,
       color,
       kind,
       revision::text AS revision,
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM mod_calendar.calendars
     WHERE household_id = $1::uuid
       AND id = $2::uuid
       AND deleted_at IS NULL
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [context.householdId, calendarId],
  );
  return result.rows[0] ?? null;
}

async function applyCalendarLayerMutation(
  context: HomiRequestContext,
  database: HomiModuleDatabase,
  input: HomiModuleServerMutationInput,
): Promise<HomiModuleServerMutationResult> {
  if (
    input.operation !== "create" &&
    input.operation !== "update" &&
    input.operation !== "delete"
  ) {
    return {
      status: "rejected",
      revision: null,
      errorCode: "CALENDAR_LAYER_OPERATION_UNSUPPORTED",
      serverState: null,
    };
  }
  if (!UUID.test(input.entityId)) {
    return {
      status: "rejected",
      revision: null,
      errorCode: "CALENDAR_LAYER_INVALID",
      serverState: null,
    };
  }
  const current = await findCalendarLayer(
    database,
    context,
    input.entityId,
    true,
  );

  if (input.operation === "create") {
    if (input.baseRevision !== "0") {
      return {
        status: "rejected",
        revision: null,
        errorCode: "CALENDAR_LAYER_CREATE_INVALID",
        serverState: null,
      };
    }
    if (current) {
      return {
        status: "conflict",
        revision: current.revision,
        errorCode: "REVISION_CONFLICT",
        serverState: calendarState(current),
      };
    }
    let parsed: ReturnType<typeof parseCalendarCreate>;
    try {
      parsed = parseCalendarCreate({
        id: input.entityId,
        ...input.payload,
      });
    } catch (error) {
      return {
        status: "rejected",
        revision: null,
        errorCode:
          typeof error === "object" && error !== null && "code" in error
            ? String((error as { code: unknown }).code)
            : "CALENDAR_LAYER_CREATE_INVALID",
        serverState: null,
      };
    }
    const result = await database.query<CalendarRow>(
      `INSERT INTO mod_calendar.calendars (
         id, household_id, name, color, kind, revision
       )
       VALUES ($1::uuid, $2::uuid, $3, $4, 'local', 1)
       RETURNING
         id::text AS id,
         household_id::text AS "householdId",
         name, color, kind,
         revision::text AS revision,
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [input.entityId, context.householdId, parsed.name, parsed.color],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Calendar layer insert returned no row.");
    return {
      status: "applied",
      revision: row.revision,
      serverState: calendarState(row),
    };
  }

  if (!current) {
    return {
      status: "rejected",
      revision: null,
      errorCode: "CALENDAR_LAYER_NOT_FOUND",
      serverState: null,
    };
  }
  if (current.revision !== input.baseRevision) {
    return {
      status: "conflict",
      revision: current.revision,
      errorCode: "REVISION_CONFLICT",
      serverState: calendarState(current),
    };
  }

  if (input.operation === "update") {
    let parsed: ReturnType<typeof parseCalendarUpdate>;
    try {
      parsed = parseCalendarUpdate({
        baseRevision: input.baseRevision,
        ...input.payload,
      });
    } catch (error) {
      return {
        status: "rejected",
        revision: current.revision,
        errorCode:
          typeof error === "object" && error !== null && "code" in error
            ? String((error as { code: unknown }).code)
            : "CALENDAR_LAYER_UPDATE_INVALID",
        serverState: calendarState(current),
      };
    }
    const result = await database.query<CalendarRow>(
      `UPDATE mod_calendar.calendars
       SET
         name = $3,
         color = $4,
         revision = revision + 1,
         updated_at = now()
       WHERE household_id = $1::uuid
         AND id = $2::uuid
       RETURNING
         id::text AS id,
         household_id::text AS "householdId",
         name, color, kind,
         revision::text AS revision,
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [context.householdId, input.entityId, parsed.name, parsed.color],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Calendar layer update returned no row.");
    return {
      status: "applied",
      revision: row.revision,
      serverState: calendarState(row),
    };
  }

  if (Object.keys(input.payload).length !== 0) {
    return {
      status: "rejected",
      revision: current.revision,
      errorCode: "CALENDAR_LAYER_DELETE_INVALID",
      serverState: calendarState(current),
    };
  }
  const usage = await database.query(
    `SELECT 1
     FROM mod_calendar.events
     WHERE household_id = $1::uuid
       AND calendar_id = $2::uuid
       AND deleted_at IS NULL
     LIMIT 1`,
    [context.householdId, input.entityId],
  );
  if (usage.rows.length > 0) {
    return {
      status: "rejected",
      revision: current.revision,
      errorCode: "CALENDAR_LAYER_IN_USE",
      serverState: calendarState(current),
    };
  }
  const settings = await readSettings(database, context);
  if (settings?.defaultCalendarId === input.entityId) {
    return {
      status: "rejected",
      revision: current.revision,
      errorCode: "CALENDAR_DEFAULT_IN_USE",
      serverState: calendarState(current),
    };
  }
  await database.query(
    `UPDATE mod_calendar.calendars
     SET
       deleted_at = now(),
       revision = revision + 1,
       updated_at = now()
     WHERE household_id = $1::uuid
       AND id = $2::uuid`,
    [context.householdId, input.entityId],
  );
  return {
    status: "applied",
    revision: String(BigInt(current.revision) + 1n),
    serverState: {
      ...calendarState(current),
      revision: String(BigInt(current.revision) + 1n),
      deleted: true,
    },
  };
}

async function applyCalendarSettingsMutation(
  context: HomiRequestContext,
  database: HomiModuleDatabase,
  input: HomiModuleServerMutationInput,
): Promise<HomiModuleServerMutationResult> {
  if (
    input.operation !== "update" ||
    input.entityId.toLowerCase() !== context.householdId.toLowerCase()
  ) {
    return {
      status: "rejected",
      revision: null,
      errorCode: "CALENDAR_SETTINGS_INVALID",
      serverState: null,
    };
  }
  let parsed: ReturnType<typeof parseSetup>;
  try {
    parsed = parseSetup(input.payload);
  } catch (error) {
    return {
      status: "rejected",
      revision: null,
      errorCode:
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "CALENDAR_SETTINGS_INVALID",
      serverState: null,
    };
  }
  const initial = await ensureInitialCalendar(database, context);
  const defaultCalendarId = parsed.defaultCalendarId ?? initial.id;
  try {
    await requireCalendar(database, context, defaultCalendarId);
  } catch {
    return {
      status: "rejected",
      revision: null,
      errorCode: "CALENDAR_DEFAULT_INVALID",
      serverState: null,
    };
  }
  const current = await readSettings(database, context);
  const currentRevision = current?.revision ?? "0";
  if (currentRevision !== input.baseRevision) {
    return {
      status: "conflict",
      revision: currentRevision,
      errorCode: "REVISION_CONFLICT",
      serverState:
        current ?? {
          state: "unconfigured",
          defaultView: "week",
          weekStart: "sunday",
          timeZone: context.timeZone,
          defaultReminder: "30m",
          defaultCalendarId: initial.id,
          revision: "0",
        },
    };
  }
  const result = await database.query<SettingsRow>(
    `INSERT INTO mod_calendar.settings (
       household_id,
       state,
       default_view,
       week_start,
       time_zone,
       default_reminder,
       default_calendar_id,
       revision
     )
     VALUES (
       $1::uuid, 'configured', $2, $3, $4,
       $5, $6::uuid, 1
     )
     ON CONFLICT (household_id)
     DO UPDATE SET
       state = 'configured',
       default_view = EXCLUDED.default_view,
       week_start = EXCLUDED.week_start,
       time_zone = EXCLUDED.time_zone,
       default_reminder = EXCLUDED.default_reminder,
       default_calendar_id = EXCLUDED.default_calendar_id,
       revision = mod_calendar.settings.revision + 1
     RETURNING
       state,
       default_view AS "defaultView",
       week_start AS "weekStart",
       time_zone AS "timeZone",
       default_reminder AS "defaultReminder",
       default_calendar_id::text AS "defaultCalendarId",
       revision::text AS revision`,
    [
      context.householdId,
      parsed.defaultView,
      parsed.weekStart,
      parsed.timeZone,
      parsed.defaultReminder,
      defaultCalendarId,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Calendar settings mutation returned no row.");
  return {
    status: "applied",
    revision: row.revision,
    serverState: row,
  };
}

function parseSetup(body: unknown): {
  defaultView: string;
  weekStart: string;
  timeZone: string;
  defaultReminder: string;
  defaultCalendarId?: string;
} {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    throw httpError(400, "CALENDAR_SETTINGS_INVALID", "A JSON object is required.");
  }
  const input = body as Record<string, unknown>;
  const defaultView = input.defaultView;
  const weekStart = input.weekStart;
  const timeZone = input.timeZone;
  const defaultReminder = input.defaultReminder ?? "none";
  const defaultCalendarId = input.defaultCalendarId;
  if (
    !["day", "week", "month", "upcoming"].includes(String(defaultView)) ||
    (weekStart !== "sunday" && weekStart !== "monday") ||
    typeof timeZone !== "string" ||
    !validTimeZone(timeZone) ||
    !["none", "30m", "1h"].includes(String(defaultReminder)) ||
    !(defaultCalendarId === undefined ||
      (typeof defaultCalendarId === "string" && UUID.test(defaultCalendarId)))
  ) {
    throw httpError(
      400,
      "CALENDAR_SETTINGS_INVALID",
      "Calendar view, week start, and time zone are invalid.",
    );
  }
  return {
    defaultView: String(defaultView),
    weekStart,
    timeZone,
    defaultReminder: String(defaultReminder),
    ...(typeof defaultCalendarId === "string"
      ? { defaultCalendarId }
      : {}),
  };
}

async function readSettings(
  database: HomiModuleDatabase,
  context: HomiRequestContext,
): Promise<SettingsRow | null> {
  const result = await database.query<SettingsRow>(
    `SELECT
       state,
       default_view AS "defaultView",
       week_start AS "weekStart",
       time_zone AS "timeZone",
       default_reminder AS "defaultReminder",
       default_calendar_id::text AS "defaultCalendarId",
       revision::text AS revision
     FROM mod_calendar.settings
     WHERE household_id = $1::uuid
     LIMIT 1`,
    [context.householdId],
  );
  return result.rows[0] ?? null;
}

function externalConnectionState(row: ExternalConnectionRow) {
  return Object.freeze({
    id: row.id,
    householdId: row.householdId,
    calendarId: row.calendarId,
    provider: row.provider,
    accountLabel: row.accountLabel,
    remoteCalendarId: row.remoteCalendarId,
    endpointUrl: row.endpointUrl,
    status: row.status,
    syncCursor: row.syncCursor,
    lastSyncedAt: iso(row.lastSyncedAt),
    lastError: row.lastError,
    revision: row.revision,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  });
}

function externalSecretKey(connectionId: string): string {
  return `external:${connectionId}`;
}

function providerLabel(provider: CalendarExternalProvider): string {
  if (provider === "google") return "Google Calendar";
  if (provider === "outlook") return "Outlook Calendar";
  return "Apple Calendar";
}

function providerColor(provider: CalendarExternalProvider): CalendarColor {
  if (provider === "google") return "blue";
  if (provider === "outlook") return "navy";
  return "pink";
}

function calendarPublicBaseUrl(request: FastifyRequest): string {
  const configured = process.env.HOMI_CALENDAR_PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const forwardedProto = request.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto;
  const protocol = proto?.split(",")[0]?.trim() || request.protocol;
  const host = request.headers.host;
  if (!host) {
    throw httpError(
      500,
      "CALENDAR_PUBLIC_URL_UNAVAILABLE",
      "Calendar could not determine the public Homi URL.",
    );
  }
  return `${protocol}://${host}`;
}

async function readExternalConnection(
  database: HomiModuleDatabase,
  context: HomiRequestContext,
  connectionId: string,
): Promise<ExternalConnectionRow | null> {
  const result = await database.query<ExternalConnectionRow>(
    `SELECT
       id::text AS id,
       household_id::text AS "householdId",
       calendar_id::text AS "calendarId",
       provider,
       account_label AS "accountLabel",
       remote_calendar_id AS "remoteCalendarId",
       endpoint_url AS "endpointUrl",
       status,
       sync_cursor AS "syncCursor",
       last_synced_at AS "lastSyncedAt",
       last_error AS "lastError",
       revision::text AS revision,
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM mod_calendar.external_connections
     WHERE household_id = $1::uuid
       AND id = $2::uuid
     LIMIT 1`,
    [context.householdId, connectionId],
  );
  return result.rows[0] ?? null;
}

async function listExternalConnections(
  database: HomiModuleDatabase,
  context: HomiRequestContext,
): Promise<readonly ExternalConnectionRow[]> {
  const result = await database.query<ExternalConnectionRow>(
    `SELECT
       id::text AS id,
       household_id::text AS "householdId",
       calendar_id::text AS "calendarId",
       provider,
       account_label AS "accountLabel",
       remote_calendar_id AS "remoteCalendarId",
       endpoint_url AS "endpointUrl",
       status,
       sync_cursor AS "syncCursor",
       last_synced_at AS "lastSyncedAt",
       last_error AS "lastError",
       revision::text AS revision,
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM mod_calendar.external_connections
     WHERE household_id = $1::uuid
     ORDER BY provider, account_label, id`,
    [context.householdId],
  );
  return result.rows;
}

async function createExternalConnection(
  host: HomiServerModuleHostContext,
  context: HomiRequestContext,
  input: {
    provider: CalendarExternalProvider;
    accountLabel: string;
    remoteCalendarId: string;
    endpointUrl?: string | null;
    secret: string;
  },
): Promise<ExternalConnectionRow> {
  const atomic = host.atomic;
  if (!atomic) {
    throw new Error(
      "Calendar requires the Core atomic module-operation capability for external calendars.",
    );
  }
  const calendarId = randomUUID();
  const connectionId = randomUUID();

  return atomic.run(context, async (services) => {
    const tx = services.database;
    const secrets = services.secrets;
    const jobs = services.jobs;
    const syncPublisher = services.sync;
    if (!secrets || !jobs || !syncPublisher) {
      throw new Error(
        "Calendar external connection requires atomic secrets, jobs, and sync services.",
      );
    }

    await tx.query(
      `INSERT INTO mod_calendar.calendars (
         id, household_id, name, color, kind, revision
       )
       VALUES ($1::uuid, $2::uuid, $3, $4, 'external', 1)`,
      [
        calendarId,
        context.householdId,
        input.accountLabel,
        providerColor(input.provider),
      ],
    );
    await tx.query(
      `INSERT INTO mod_calendar.external_connections (
         id, household_id, calendar_id, provider,
         account_label, remote_calendar_id, endpoint_url,
         status, revision
       )
       VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4,
         $5, $6, $7, 'connected', 1
       )`,
      [
        connectionId,
        context.householdId,
        calendarId,
        input.provider,
        input.accountLabel,
        input.remoteCalendarId,
        input.endpointUrl ?? null,
      ],
    );
    await secrets.set(
      context,
      externalSecretKey(connectionId),
      input.secret,
    );
    await jobs.schedule(context, {
      jobType: "external-sync",
      runAt: new Date().toISOString(),
      dedupeKey: `external-sync:${connectionId}`,
      payload: { connectionId },
    });

    const row = await readExternalConnection(
      tx,
      context,
      connectionId,
    );
    if (!row) {
      throw new Error(
        "External Calendar connection was not created.",
      );
    }
    const layer = await findCalendarLayer(
      tx,
      context,
      calendarId,
    );
    if (!layer) {
      throw new Error(
        "External Calendar layer was not created.",
      );
    }
    await syncPublisher.publish(context, {
      entityType: "calendar-layer",
      entityId: layer.id,
      operation: "create",
      revision: layer.revision,
      serverState: calendarState(layer),
    });
    return row;
  });
}

function externalRange(): { start: string; end: string } {
  const now = Date.now();
  return {
    start: new Date(now - 120 * 86_400_000).toISOString(),
    end: new Date(now + 400 * 86_400_000).toISOString(),
  };
}

function externalEventEquals(
  current: CalendarEvent,
  external: CalendarExternalEvent,
): boolean {
  return (
    current.title === external.title &&
    current.description === external.description &&
    current.allDay === external.allDay &&
    current.timeZone === external.timeZone &&
    current.startsAt === external.startsAt &&
    current.endsAt === external.endsAt &&
    current.startDate === external.startDate &&
    current.endDateExclusive === external.endDateExclusive &&
    current.location === external.location
  );
}

async function syncExternalConnection(
  host: HomiServerModuleHostContext,
  database: HomiModuleDatabase,
  context: HomiRequestContext,
  connectionId: string,
): Promise<void> {
  const secrets = host.secrets;
  const atomic = host.atomic;
  if (!secrets || !atomic) {
    throw new Error(
      "Calendar external sync requires secrets and atomic Core capabilities.",
    );
  }
  const connection = await readExternalConnection(
    database,
    context,
    connectionId,
  );
  if (!connection || connection.status === "disabled") return;
  const secret = await secrets.get(
    context,
    externalSecretKey(connection.id),
  );
  if (!secret) {
    throw new Error("External Calendar credentials are unavailable.");
  }
  const range = externalRange();

  try {
    const fetched = await fetchExternalEvents({
      connection: {
        provider: connection.provider,
        remoteCalendarId: connection.remoteCalendarId,
        endpointUrl: connection.endpointUrl,
      },
      secret,
      rangeStart: range.start,
      rangeEnd: range.end,
    });

    await atomic.run(context, async (services) => {
      const tx = services.database;
      const atomicSecrets = services.secrets;
      const jobs = services.jobs;
      const syncPublisher = services.sync;
      if (!atomicSecrets || !jobs || !syncPublisher) {
        throw new Error(
          "Calendar external sync requires atomic secrets, jobs, and sync services.",
        );
      }
      const currentConnection = await readExternalConnection(
        tx,
        context,
        connection.id,
      );
      if (!currentConnection || currentConnection.status === "disabled") {
        return;
      }
      if (currentConnection.revision !== connection.revision) {
        throw new Error(
          "External Calendar connection changed while provider data was being fetched; retry sync with the newest connection state.",
        );
      }
      if (fetched.replacementSecret) {
        await atomicSecrets.set(
          context,
          externalSecretKey(currentConnection.id),
          fetched.replacementSecret,
        );
      }

      const seen = new Set<string>();
      for (const external of fetched.events) {
      seen.add(external.remoteId);
      const existingResult = await tx.query<EventRow>(
        `${EVENT_SELECT}
         WHERE household_id = $1::uuid
           AND external_connection_id = $2::uuid
           AND remote_event_id = $3
         LIMIT 1`,
        [context.householdId, currentConnection.id, external.remoteId],
      );
      const existingRow = existingResult.rows[0] ?? null;
      if (external.cancelled) {
        if (existingRow && existingRow.deletedAt === null) {
          const deleted = await tx.query<{ revision: string }>(
            `UPDATE mod_calendar.events
             SET
               deleted_at = now(),
               remote_etag = $4,
               remote_updated_at = $5::timestamptz,
               revision = revision + 1,
               updated_at = now(),
               updated_by_user_id = $6::uuid
             WHERE household_id = $1::uuid
               AND external_connection_id = $2::uuid
               AND remote_event_id = $3
             RETURNING revision::text AS revision`,
            [
              context.householdId,
              currentConnection.id,
              external.remoteId,
              external.etag,
              external.remoteUpdatedAt,
              context.userId,
            ],
          );
          const revision = deleted.rows[0]?.revision;
          if (revision) {
            await syncPublisher.publish(context, {
              entityType: "event",
              entityId: existingRow.id,
              operation: "delete",
              revision,
            });
          }
        }
        continue;
      }

      if (!existingRow) {
        const eventId = randomUUID();
        const created = await tx.query<EventRow>(
          `INSERT INTO mod_calendar.events (
             id, household_id, calendar_id, title, description,
             all_day, time_zone, starts_at, ends_at,
             start_date, end_date_exclusive, location, notes,
             recurrence, recurrence_overrides, person_ids,
             reminder_minutes, transport, color, revision,
             created_by_user_id, updated_by_user_id,
             external_connection_id, remote_event_id,
             remote_etag, remote_updated_at
           )
           VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4, $5,
             $6, $7, $8::timestamptz, $9::timestamptz,
             $10::date, $11::date, $12, NULL,
             NULL, '[]'::jsonb, '{}'::uuid[],
             '{}'::integer[],
             '{"mode":"none","notes":null,"pickupPersonId":null,"dropoffPersonId":null}'::jsonb,
             (SELECT color FROM mod_calendar.calendars WHERE id = $3::uuid),
             1, $13::uuid, $13::uuid,
             $14::uuid, $15, $16, $17::timestamptz
           )
           RETURNING ${EVENT_SELECT.slice(EVENT_SELECT.indexOf('SELECT') + 6, EVENT_SELECT.indexOf('FROM mod_calendar.events')).trim()}`,
          [
            eventId,
            context.householdId,
            currentConnection.calendarId,
            external.title,
            external.description,
            external.allDay,
            external.timeZone,
            external.startsAt,
            external.endsAt,
            external.startDate,
            external.endDateExclusive,
            external.location,
            context.userId,
            currentConnection.id,
            external.remoteId,
            external.etag,
            external.remoteUpdatedAt,
          ],
        );
        const row = created.rows[0];
        if (!row) throw new Error("External Calendar event insert returned no row.");
        const state = eventState(row);
        await syncPublisher.publish(context, {
          entityType: "event",
          entityId: row.id,
          operation: "create",
          revision: row.revision,
          serverState: state,
        });
        continue;
      }

      const current = eventState(existingRow);
      if (
        existingRow.deletedAt === null &&
        externalEventEquals(current, external) &&
        existingRow.remoteEtag === external.etag
      ) {
        continue;
      }
      const updated = await tx.query<EventRow>(
        `UPDATE mod_calendar.events
         SET
           calendar_id = $3::uuid,
           title = $4,
           description = $5,
           all_day = $6,
           time_zone = $7,
           starts_at = $8::timestamptz,
           ends_at = $9::timestamptz,
           start_date = $10::date,
           end_date_exclusive = $11::date,
           location = $12,
           notes = NULL,
           recurrence = NULL,
           recurrence_overrides = '[]'::jsonb,
           person_ids = '{}'::uuid[],
           reminder_minutes = '{}'::integer[],
           transport = '{"mode":"none","notes":null,"pickupPersonId":null,"dropoffPersonId":null}'::jsonb,
           color = (SELECT color FROM mod_calendar.calendars WHERE id = $3::uuid),
           remote_etag = $13,
           remote_updated_at = $14::timestamptz,
           deleted_at = NULL,
           revision = revision + 1,
           updated_at = now(),
           updated_by_user_id = $15::uuid
         WHERE household_id = $1::uuid
           AND id = $2::uuid
         RETURNING ${EVENT_SELECT.slice(EVENT_SELECT.indexOf('SELECT') + 6, EVENT_SELECT.indexOf('FROM mod_calendar.events')).trim()}`,
        [
          context.householdId,
          existingRow.id,
          currentConnection.calendarId,
          external.title,
          external.description,
          external.allDay,
          external.timeZone,
          external.startsAt,
          external.endsAt,
          external.startDate,
          external.endDateExclusive,
          external.location,
          external.etag,
          external.remoteUpdatedAt,
          context.userId,
        ],
      );
      const row = updated.rows[0];
      if (!row) throw new Error("External Calendar event update returned no row.");
      const state = eventState(row);
      await syncPublisher.publish(context, {
        entityType: "event",
        entityId: row.id,
        operation: "update",
        revision: row.revision,
        serverState: state,
      });
    }

    const stale = await tx.query<EventRow>(
      `${EVENT_SELECT}
       WHERE household_id = $1::uuid
         AND external_connection_id = $2::uuid
         AND deleted_at IS NULL`,
      [context.householdId, currentConnection.id],
    );
    for (const row of stale.rows) {
      if (!row.remoteEventId || seen.has(row.remoteEventId)) continue;
      const deleted = await tx.query<{ revision: string }>(
        `UPDATE mod_calendar.events
         SET
           deleted_at = now(),
           revision = revision + 1,
           updated_at = now(),
           updated_by_user_id = $3::uuid
         WHERE household_id = $1::uuid
           AND id = $2::uuid
         RETURNING revision::text AS revision`,
        [context.householdId, row.id, context.userId],
      );
      const revision = deleted.rows[0]?.revision;
      if (revision) {
        await syncPublisher.publish(context, {
          entityType: "event",
          entityId: row.id,
          operation: "delete",
          revision,
        });
      }
    }

    await tx.query(
      `UPDATE mod_calendar.external_connections
       SET
         status = 'connected',
         last_synced_at = now(),
         last_error = NULL,
         revision = revision + 1,
         updated_at = now()
       WHERE household_id = $1::uuid
         AND id = $2::uuid`,
      [context.householdId, currentConnection.id],
    );
    await jobs.schedule(context, {
      jobType: "external-sync",
      runAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      dedupeKey: `external-sync:${currentConnection.id}`,
      payload: { connectionId: currentConnection.id },
    });

    });
  } catch (error) {
    await database.query(
      `UPDATE mod_calendar.external_connections
       SET
         status = 'error',
         last_error = $3,
         revision = revision + 1,
         updated_at = now()
       WHERE household_id = $1::uuid
         AND id = $2::uuid
         AND status <> 'disabled'`,
      [
        context.householdId,
        connection.id,
        error instanceof Error
          ? error.message.slice(0, 4000)
          : String(error).slice(0, 4000),
      ],
    );
    throw error;
  }
}

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function icsDate(value: string): string {
  return value.replaceAll("-", "");
}

function icsInstant(value: string): string {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.000Z$/, "Z");
}

function zonedWallInstant(
  date: string,
  clock: string,
  timeZone: string,
): string {
  const [hour, minute, second] = clock.split(":").map(Number);
  const desired = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    hour ?? 0,
    minute ?? 0,
    second ?? 0,
  );
  let guess = desired;
  for (let index = 0; index < 4; index += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    const observed = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    const correction = desired - observed;
    if (correction === 0) break;
    guess += correction;
  }
  return new Date(guess).toISOString();
}

function localClockForIso(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.hour}:${values.minute}:${values.second}`;
}

function recurrenceRule(event: CalendarEvent): string | null {
  const recurrence = event.recurrence;
  if (!recurrence) return null;
  const parts = [
    `FREQ=${recurrence.frequency.toUpperCase()}`,
    `INTERVAL=${recurrence.interval}`,
  ];
  if (recurrence.frequency === "weekly" && recurrence.weekdays.length > 0) {
    const days = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    parts.push(
      `BYDAY=${recurrence.weekdays.map((day) => days[day]!).join(",")}`,
    );
  }
  if (recurrence.endDate) {
    if (event.allDay) {
      parts.push(`UNTIL=${icsDate(recurrence.endDate)}`);
    } else {
      const clock = localClockForIso(event.startsAt!, event.timeZone);
      parts.push(
        `UNTIL=${icsInstant(
          zonedWallInstant(recurrence.endDate, clock, event.timeZone),
        )}`,
      );
    }
  }
  return parts.join(";");
}

function icsEventLines(
  event: CalendarEvent,
): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.id}@homi`,
    `DTSTAMP:${icsInstant(event.updatedAt)}`,
    `SUMMARY:${icsEscape(event.title)}`,
  ];
  if (event.description) {
    lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${icsEscape(event.location)}`);
  }
  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(event.startDate!)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(event.endDateExclusive!)}`);
  } else {
    lines.push(`DTSTART:${icsInstant(event.startsAt!)}`);
    lines.push(`DTEND:${icsInstant(event.endsAt!)}`);
  }
  const rrule = recurrenceRule(event);
  if (rrule) lines.push(`RRULE:${rrule}`);

  const clock = event.allDay
    ? null
    : localClockForIso(event.startsAt!, event.timeZone);
  for (const override of event.recurrenceOverrides) {
    if (override.action !== "skip") continue;
    if (event.allDay) {
      lines.push(
        `EXDATE;VALUE=DATE:${icsDate(override.occurrenceDate)}`,
      );
    } else {
      lines.push(
        `EXDATE:${icsInstant(
          zonedWallInstant(
            override.occurrenceDate,
            clock!,
            event.timeZone,
          ),
        )}`,
      );
    }
  }
  lines.push("END:VEVENT");

  for (const override of event.recurrenceOverrides) {
    if (override.action !== "replace" || !override.replacement) continue;
    const replacement = override.replacement;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.id}@homi`);
    lines.push(`DTSTAMP:${icsInstant(event.updatedAt)}`);
    if (event.allDay) {
      lines.push(
        `RECURRENCE-ID;VALUE=DATE:${icsDate(override.occurrenceDate)}`,
      );
    } else {
      lines.push(
        `RECURRENCE-ID:${icsInstant(
          zonedWallInstant(
            override.occurrenceDate,
            clock!,
            event.timeZone,
          ),
        )}`,
      );
    }
    lines.push(`SUMMARY:${icsEscape(replacement.title)}`);
    if (replacement.description) {
      lines.push(`DESCRIPTION:${icsEscape(replacement.description)}`);
    }
    if (replacement.location) {
      lines.push(`LOCATION:${icsEscape(replacement.location)}`);
    }
    if (replacement.allDay) {
      lines.push(
        `DTSTART;VALUE=DATE:${icsDate(replacement.startDate!)}`,
      );
      lines.push(
        `DTEND;VALUE=DATE:${icsDate(replacement.endDateExclusive!)}`,
      );
    } else {
      lines.push(`DTSTART:${icsInstant(replacement.startsAt!)}`);
      lines.push(`DTEND:${icsInstant(replacement.endsAt!)}`);
    }
    lines.push("END:VEVENT");
  }
  return lines;
}

function buildIcsFeed(
  householdId: string,
  events: readonly CalendarEvent[],
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Homi//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:Homi ${householdId.slice(0, 8)}`,
  ];
  for (const event of events) {
    lines.push(...icsEventLines(event));
  }
  lines.push("END:VCALENDAR", "");
  return lines.join("\r\n");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function brokerDate(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !DATE.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  ) {
    throw httpError(400, "CALENDAR_BROKER_INVALID", `${field} must be a calendar date.`);
  }
  return value;
}

function linkedEventId(payload: Record<string, unknown>): string {
  const sourceModule = payload.sourceModule;
  const sourceEntityType = payload.sourceEntityType;
  const sourceEntityId = payload.sourceEntityId;
  if (
    typeof sourceModule !== "string" ||
    typeof sourceEntityType !== "string" ||
    typeof sourceEntityId !== "string" ||
    !UUID.test(sourceEntityId)
  ) {
    throw httpError(400, "CALENDAR_LINK_INVALID", "Linked-event source identity is invalid.");
  }
  const hex = createHash("sha256")
    .update(sourceModule + ":" + sourceEntityType + ":" + sourceEntityId)
    .digest("hex");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-4" +
    hex.slice(13, 16) + "-8" + hex.slice(17, 20) + "-" + hex.slice(20, 32);
}

function nextDate(date: string): string {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

async function brokerLinkedEvents(
  host: HomiServerModuleHostContext,
  database: HomiModuleDatabase,
  context: HomiRequestContext,
  invocation: HomiBrokerInvocation,
) {
  const rawPayload = invocation.payload;
  if (
    typeof rawPayload !== "object" ||
    rawPayload === null ||
    Array.isArray(rawPayload)
  ) {
    throw httpError(
      400,
      "CALENDAR_LINK_INVALID",
      "Linked-event payload must be an object.",
    );
  }
  const payload = rawPayload as Record<string, unknown>;
  const eventId = linkedEventId(payload);
  const current = await findEvent(database, context, eventId, true);

  if (invocation.action === "remove-linked-event") {
    if (!current || current.deletedAt !== null) return { eventId, removed: false };
    const result = await applyEventMutation(host, context, database, {
      entityId: eventId,
      operation: "delete",
      baseRevision: current.revision,
      payload: {},
    }, {});
    if (result.status !== "applied") throw new Error("Calendar linked event removal failed.");
    return { eventId, removed: true };
  }
  if (invocation.action !== "upsert-linked-event") {
    throw httpError(400, "CALENDAR_BROKER_ACTION_UNSUPPORTED", "Unsupported Calendar linked-event action.");
  }
  const title = payload.title;
  const date = payload.date;
  const color = payload.color;
  const notes = payload.notes;
  const recurrence = payload.recurrence;
  if (
    typeof title !== "string" || title.trim().length < 1 ||
    typeof date !== "string" || !DATE.test(date) ||
    typeof color !== "string" || !validCalendarColor(color) ||
    !(notes === null || notes === undefined || typeof notes === "string") ||
    !(recurrence === null || recurrence === undefined ||
      (typeof recurrence === "object" && !Array.isArray(recurrence)))
  ) {
    throw httpError(400, "CALENDAR_LINK_INVALID", "Linked-event payload is invalid.");
  }
  let calendarRecurrence: CalendarEvent["recurrence"] = null;
  if (recurrence && typeof recurrence === "object") {
    const rule = recurrence as Record<string, unknown>;
    if (
      !["daily", "weekly", "monthly", "yearly"].includes(String(rule.frequency)) ||
      !Number.isInteger(rule.interval) || Number(rule.interval) < 1 ||
      !(rule.until === null || typeof rule.until === "string" && DATE.test(rule.until))
    ) {
      throw httpError(400, "CALENDAR_LINK_INVALID", "Linked-event recurrence is invalid.");
    }
    calendarRecurrence = {
      frequency: rule.frequency as CalendarEvent["recurrence"] extends infer R
        ? R extends { frequency: infer F } ? F : never : never,
      interval: Number(rule.interval),
      weekdays: [],
      endDate: rule.until as string | null,
    };
  }
  if (current?.deletedAt !== null && current) {
    await database.query(
      `UPDATE mod_calendar.events SET deleted_at=NULL WHERE household_id=$1::uuid AND id=$2::uuid`,
      [context.householdId, eventId],
    );
  }
  const active = await findEvent(database, context, eventId, true);
  const calendar = await ensureInitialCalendar(database, context);
  const result = await applyEventMutation(host, context, database, {
    entityId: eventId,
    operation: active ? "update" : "create",
    baseRevision: active?.revision ?? "0",
    payload: {
      calendarId: active?.calendarId ?? calendar.id,
      title: title.trim(),
      description: "Linked from " + String(payload.sourceModule),
      allDay: true,
      timeZone: active?.timeZone ?? context.timeZone,
      startsAt: null,
      endsAt: null,
      startDate: date,
      endDateExclusive: nextDate(date),
      notes: typeof notes === "string" ? notes : null,
      recurrence: calendarRecurrence,
      color,
    },
  }, {});
  if (result.status !== "applied") {
    throw new Error("Calendar linked event upsert failed: " + (result.errorCode ?? result.status));
  }
  return { eventId };
}

async function brokerRange(
  database: HomiModuleDatabase,
  context: HomiRequestContext,
  payload: unknown,
): Promise<unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw httpError(400, "CALENDAR_BROKER_INVALID", "Range payload must be an object.");
  }
  const input = payload as Record<string, unknown>;
  const startDate = brokerDate(input.startDate, "startDate");
  const endDateExclusive = brokerDate(input.endDateExclusive, "endDateExclusive");
  if (endDateExclusive <= startDate) {
    throw httpError(400, "CALENDAR_BROKER_INVALID", "Range end must be after its start.");
  }
  const spanDays = Math.ceil(
    (Date.parse(`${endDateExclusive}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) /
      86_400_000,
  );
  if (spanDays > 400) {
    throw httpError(400, "CALENDAR_BROKER_RANGE_TOO_LARGE", "Calendar range may not exceed 400 days.");
  }
  const limit = input.limit === undefined ? 500 : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) {
    throw httpError(400, "CALENDAR_BROKER_INVALID", "Range limit must be from 1 to 2000.");
  }
  const result = await database.query<EventRow>(
    `${EVENT_SELECT}
     WHERE household_id = $1::uuid
       AND deleted_at IS NULL
     ORDER BY COALESCE(starts_at, start_date::timestamptz), title, id`,
    [context.householdId],
  );
  const events = result.rows.map(eventState);
  const occurrences = expandCalendarEvents(events, startDate, endDateExclusive)
    .slice(0, limit)
    .map((item) => Object.freeze({
      occurrenceId: item.occurrenceId,
      seriesEventId: item.seriesEventId,
      occurrenceDate: item.occurrenceDate,
      recurring: item.recurring,
      event: item.event,
    }));
  return Object.freeze({
    startDate,
    endDateExclusive,
    truncated: occurrences.length >= limit,
    occurrences: Object.freeze(occurrences),
  });
}

async function brokerTransport(
  database: HomiModuleDatabase,
  context: HomiRequestContext,
  payload: unknown,
): Promise<unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw httpError(400, "CALENDAR_BROKER_INVALID", "Transportation payload must be an object.");
  }
  const eventId = (payload as Record<string, unknown>).eventId;
  if (typeof eventId !== "string" || !UUID.test(eventId)) {
    throw httpError(400, "CALENDAR_BROKER_INVALID", "eventId must be a UUID.");
  }
  const row = await findEvent(database, context, eventId);
  if (!row || row.deletedAt !== null) {
    throw httpError(404, "CALENDAR_EVENT_NOT_FOUND", "The Calendar event was not found.");
  }
  const event = eventState(row);
  return Object.freeze({
    eventId: event.id,
    title: event.title,
    personIds: event.personIds,
    transport: event.transport,
    recurrenceOverrides: event.recurrenceOverrides.map((override) =>
      Object.freeze({
        occurrenceDate: override.occurrenceDate,
        action: override.action,
        transport: override.replacement?.transport ?? null,
        personIds: override.replacement?.personIds ?? [],
      }),
    ),
  });
}

export function createHomiServerModule(
  host: HomiServerModuleHostContext,
) {
  const database = host.moduleDatabase;

  return defineHomiServerModule({
    moduleKey: CALENDAR_MODULE_KEY,
    moduleApiVersion: HOMI_MODULE_API_VERSION,

    register(app: FastifyInstance) {
      app.get(
        "/api/v1/modules/calendar/chequebook/options",
        async (request) => {
          const context = await requestContext(host, request);
          if (!host.broker) {
            throw httpError(
              409,
              "CALENDAR_CHEQUEBOOK_UNAVAILABLE",
              "Install and enable Chequebook from Modules to use this feature.",
            );
          }
          const capability = await host.broker.status(
            context,
            "chequebook.transactions.v1",
          );
          if (!capability.available) {
            throw httpError(
              409,
              "CALENDAR_CHEQUEBOOK_UNAVAILABLE",
              capability.state === "not-installed"
                ? "Install Chequebook from Modules to use this feature."
                : "Enable Chequebook for this household to use this feature.",
            );
          }
          return {
            data: await host.broker.invoke(
              context,
              "chequebook.transactions.v1",
              { action: "options", payload: {} },
            ),
          };
        },
      );

      app.put(
        "/api/v1/modules/calendar/events/:id/chequebook",
        async (request) => {
          const context = await requestContext(host, request);
          if (!host.broker) {
            throw httpError(
              409,
              "CALENDAR_CHEQUEBOOK_UNAVAILABLE",
              "Install and enable Chequebook from Modules to use this feature.",
            );
          }
          const capability = await host.broker.status(
            context,
            "chequebook.transactions.v1",
          );
          if (!capability.available) {
            throw httpError(
              409,
              "CALENDAR_CHEQUEBOOK_UNAVAILABLE",
              capability.state === "not-installed"
                ? "Install Chequebook from Modules to use this feature."
                : "Enable Chequebook for this household to use this feature.",
            );
          }
          const params = request.params as { id?: unknown };
          if (typeof params.id !== "string" || !UUID.test(params.id)) {
            throw httpError(
              400,
              "CALENDAR_EVENT_ID_INVALID",
              "Calendar event ID is invalid.",
            );
          }
          const eventId = params.id;
          const row = await findEvent(database, context, eventId);
          if (!row) {
            throw httpError(
              404,
              "CALENDAR_EVENT_NOT_FOUND",
              "Calendar event not found.",
            );
          }
          const body = request.body;
          if (
            typeof body !== "object" ||
            body === null ||
            Array.isArray(body)
          ) {
            throw httpError(
              400,
              "CALENDAR_CHEQUEBOOK_INVALID",
              "Chequebook link details are required.",
            );
          }
          const input = body as Record<string, unknown>;
          if (input.enabled === false) {
            return {
              data: await host.broker.invoke(
                context,
                "chequebook.transactions.v1",
                {
                  action: "remove-linked-entry",
                  payload: {
                    sourceModule: CALENDAR_MODULE_KEY,
                    sourceEntityType: "event",
                    sourceEntityId: eventId,
                  },
                },
              ),
            };
          }
          const event = eventState(row);
          if (!event.recurrence) {
            throw httpError(
              400,
              "CALENDAR_CHEQUEBOOK_RECURRING_REQUIRED",
              "Only repeating Calendar events can create recurring Chequebook entries.",
            );
          }
          const startDate =
            event.startDate ??
            event.startsAt?.slice(0, 10) ??
            null;
          if (!startDate) {
            throw httpError(
              400,
              "CALENDAR_CHEQUEBOOK_DATE_REQUIRED",
              "The Calendar event has no usable start date.",
            );
          }
          return {
            data: await host.broker.invoke(
              context,
              "chequebook.transactions.v1",
              {
                action: "upsert-linked-recurring",
                payload: {
                  sourceModule: CALENDAR_MODULE_KEY,
                  sourceEntityType: "event",
                  sourceEntityId: eventId,
                  accountId: input.accountId,
                  categoryId: input.categoryId ?? null,
                  kind: input.kind,
                  amount: input.amount,
                  label: event.title,
                  notes: event.notes,
                  startDate,
                  frequency: event.recurrence.frequency,
                  interval: event.recurrence.interval,
                  recurrenceUntil: event.recurrence.endDate,
                  active: true,
                },
              },
            ),
          };
        },
      );

      app.get(
        "/api/v1/modules/calendar/setup",
        async (request) => {
          const context = await requestContext(host, request);
          const calendar = await ensureInitialCalendar(
            database,
            context,
          );
          const settings = await readSettings(database, context);
          return {
            data:
              settings ?? {
                state: "unconfigured",
                defaultView: "week",
                weekStart: "sunday",
                timeZone: context.timeZone,
                defaultReminder: "30m",
                defaultCalendarId: calendar.id,
                revision: "0",
              },
          };
        },
      );

      app.put(
        "/api/v1/modules/calendar/setup",
        async (request) => {
          const context = await requestContext(host, request);
          const input = parseSetup(request.body);
          const calendar = await ensureInitialCalendar(
            database,
            context,
          );
          const defaultCalendarId = input.defaultCalendarId ?? calendar.id;
          await requireCalendar(database, context, defaultCalendarId);
          const result = await database.query<SettingsRow>(
            `INSERT INTO mod_calendar.settings (
               household_id,
               state,
               default_view,
               week_start,
               time_zone,
               default_reminder,
               default_calendar_id,
               revision
             )
             VALUES (
               $1::uuid, 'configured', $2, $3, $4,
               $5, $6::uuid, 1
             )
             ON CONFLICT (household_id)
             DO UPDATE SET
               state = 'configured',
               default_view = EXCLUDED.default_view,
               week_start = EXCLUDED.week_start,
               time_zone = EXCLUDED.time_zone,
               default_reminder = EXCLUDED.default_reminder,
               default_calendar_id = EXCLUDED.default_calendar_id,
               revision = mod_calendar.settings.revision + 1
             RETURNING
               state,
               default_view AS "defaultView",
               week_start AS "weekStart",
               time_zone AS "timeZone",
               default_reminder AS "defaultReminder",
               default_calendar_id::text AS "defaultCalendarId",
               revision::text AS revision`,
            [
              context.householdId,
              input.defaultView,
              input.weekStart,
              input.timeZone,
              input.defaultReminder,
              defaultCalendarId,
            ],
          );
          const saved = result.rows[0];
          if (!saved) {
            throw new Error("Calendar setup write returned no row.");
          }
          return { data: saved };
        },
      );

      app.get(
        "/api/v1/modules/calendar/ics/feeds",
        async (request) => {
          const context = await requestContext(host, request);
          const result = await database.query<IcsFeedRow>(
            `SELECT
               id::text AS id,
               household_id::text AS "householdId",
               label,
               created_at AS "createdAt",
               revoked_at AS "revokedAt"
             FROM mod_calendar.ics_feeds
             WHERE household_id = $1::uuid
             ORDER BY created_at, id`,
            [context.householdId],
          );
          return {
            data: result.rows.map((row) => ({
              id: row.id,
              label: row.label,
              createdAt: iso(row.createdAt),
              active: row.revokedAt === null,
            })),
          };
        },
      );

      app.post(
        "/api/v1/modules/calendar/ics/feeds",
        async (request) => {
          const context = await requestContext(host, request);
          const body = request.body as Record<string, unknown> | null;
          const label =
            body && typeof body.label === "string"
              ? body.label.trim()
              : "";
          if (label.length < 1 || label.length > 200) {
            throw httpError(
              400,
              "CALENDAR_ICS_LABEL_INVALID",
              "ICS feed label must contain 1 to 200 characters.",
            );
          }
          const token = randomBytes(32).toString("base64url");
          const result = await database.query<IcsFeedRow>(
            `INSERT INTO mod_calendar.ics_feeds (
               household_id, label, token_hash,
               created_by_user_id
             )
             VALUES ($1::uuid, $2, $3, $4::uuid)
             RETURNING
               id::text AS id,
               household_id::text AS "householdId",
               label,
               created_at AS "createdAt",
               revoked_at AS "revokedAt"`,
            [
              context.householdId,
              label,
              tokenHash(token),
              context.userId,
            ],
          );
          const row = result.rows[0];
          if (!row) throw new Error("ICS feed creation returned no row.");
          return {
            data: {
              id: row.id,
              label: row.label,
              feedUrl:
                `${calendarPublicBaseUrl(request)}` +
                `/api/v1/modules/calendar/ics/${token}.ics`,
            },
          };
        },
      );

      app.post(
        "/api/v1/modules/calendar/ics/feeds/:feedId/regenerate",
        async (request) => {
          const context = await requestContext(host, request);
          const params = request.params as { feedId?: unknown };
          if (typeof params.feedId !== "string" || !UUID.test(params.feedId)) {
            throw httpError(
              400,
              "CALENDAR_ICS_FEED_INVALID",
              "feedId must be a UUID.",
            );
          }
          const token = randomBytes(32).toString("base64url");
          const result = await database.query<IcsFeedRow>(
            `UPDATE mod_calendar.ics_feeds
             SET token_hash = $3, revoked_at = NULL
             WHERE household_id = $1::uuid
               AND id = $2::uuid
             RETURNING
               id::text AS id,
               household_id::text AS "householdId",
               label,
               created_at AS "createdAt",
               revoked_at AS "revokedAt"`,
            [context.householdId, params.feedId, tokenHash(token)],
          );
          const row = result.rows[0];
          if (!row) {
            throw httpError(
              404,
              "CALENDAR_ICS_FEED_NOT_FOUND",
              "ICS feed was not found.",
            );
          }
          return {
            data: {
              id: row.id,
              label: row.label,
              feedUrl:
                `${calendarPublicBaseUrl(request)}` +
                `/api/v1/modules/calendar/ics/${token}.ics`,
            },
          };
        },
      );

      app.delete(
        "/api/v1/modules/calendar/ics/feeds/:feedId",
        async (request) => {
          const context = await requestContext(host, request);
          const params = request.params as { feedId?: unknown };
          if (typeof params.feedId !== "string" || !UUID.test(params.feedId)) {
            throw httpError(
              400,
              "CALENDAR_ICS_FEED_INVALID",
              "feedId must be a UUID.",
            );
          }
          const result = await database.query(
            `UPDATE mod_calendar.ics_feeds
             SET revoked_at = now()
             WHERE household_id = $1::uuid
               AND id = $2::uuid
               AND revoked_at IS NULL
             RETURNING id`,
            [context.householdId, params.feedId],
          );
          if (result.rowCount === 0) {
            throw httpError(
              404,
              "CALENDAR_ICS_FEED_NOT_FOUND",
              "Active ICS feed was not found.",
            );
          }
          return { data: { status: "revoked" } };
        },
      );

      app.get(
        "/api/v1/modules/calendar/ics/:token.ics",
        async (request, reply: FastifyReply) => {
          const params = request.params as { token?: unknown };
          if (
            typeof params.token !== "string" ||
            !/^[A-Za-z0-9_-]{32,128}$/.test(params.token)
          ) {
            throw httpError(
              404,
              "CALENDAR_ICS_FEED_NOT_FOUND",
              "ICS feed was not found.",
            );
          }
          const feed = await database.query<IcsFeedRow>(
            `SELECT
               id::text AS id,
               household_id::text AS "householdId",
               label,
               created_at AS "createdAt",
               revoked_at AS "revokedAt"
             FROM mod_calendar.ics_feeds
             WHERE token_hash = $1
               AND revoked_at IS NULL
             LIMIT 1`,
            [tokenHash(params.token)],
          );
          const row = feed.rows[0];
          if (!row) {
            throw httpError(
              404,
              "CALENDAR_ICS_FEED_NOT_FOUND",
              "ICS feed was not found.",
            );
          }
          const events = await database.query<EventRow>(
            `${EVENT_SELECT}
             WHERE household_id = $1::uuid
               AND deleted_at IS NULL
             ORDER BY COALESCE(starts_at, start_date::timestamptz), id`,
            [row.householdId],
          );
          return reply
            .header("Content-Type", "text/calendar; charset=utf-8")
            .header("Cache-Control", "private, no-store")
            .send(
              buildIcsFeed(
                row.householdId,
                events.rows.map(eventState),
              ),
            );
        },
      );

      app.get(
        "/api/v1/modules/calendar/external/providers",
        async (request) => {
          await requestContext(host, request);
          return {
            data: [
              {
                provider: "google",
                configured: providerConfigured("google"),
                mode: "oauth",
              },
              {
                provider: "outlook",
                configured: providerConfigured("outlook"),
                mode: "oauth",
              },
              {
                provider: "apple",
                configured: providerConfigured("apple"),
                mode: "caldav",
              },
            ],
          };
        },
      );

      app.get(
        "/api/v1/modules/calendar/external/connections",
        async (request) => {
          const context = await requestContext(host, request);
          const rows = await listExternalConnections(database, context);
          return {
            data: rows.map(externalConnectionState),
          };
        },
      );

      app.post(
        "/api/v1/modules/calendar/external/:provider/oauth/start",
        async (request) => {
          const context = await requestContext(host, request);
          const params = request.params as { provider?: unknown };
          const provider = params.provider;
          if (provider !== "google" && provider !== "outlook") {
            throw httpError(
              400,
              "CALENDAR_PROVIDER_INVALID",
              "OAuth provider must be google or outlook.",
            );
          }
          if (!providerConfigured(provider)) {
            throw httpError(
              503,
              "CALENDAR_PROVIDER_NOT_CONFIGURED",
              `${providerLabel(provider)} is not configured on this Homi server.`,
            );
          }
          const redirectUri =
            `${calendarPublicBaseUrl(request)}` +
            `/api/v1/modules/calendar/external/${provider}/oauth/callback`;
          const oauth = createOAuthRequest(provider, redirectUri);
          await database.query(
            `INSERT INTO mod_calendar.oauth_states (
               state_hash, provider, household_id, context,
               code_verifier, redirect_uri, return_to,
               expires_at
             )
             VALUES (
               $1, $2, $3::uuid, $4::jsonb,
               $5, $6, '/modules/calendar',
               now() + interval '10 minutes'
             )`,
            [
              oauth.stateHash,
              provider,
              context.householdId,
              JSON.stringify(context),
              oauth.codeVerifier,
              redirectUri,
            ],
          );
          return {
            data: {
              provider,
              authorizationUrl: oauth.authorizationUrl,
            },
          };
        },
      );

      app.get(
        "/api/v1/modules/calendar/external/:provider/oauth/callback",
        async (request, reply: FastifyReply) => {
          const params = request.params as { provider?: unknown };
          const query = request.query as {
            state?: unknown;
            code?: unknown;
            error?: unknown;
            error_description?: unknown;
          };
          const provider = params.provider;
          if (provider !== "google" && provider !== "outlook") {
            throw httpError(
              400,
              "CALENDAR_PROVIDER_INVALID",
              "OAuth provider must be google or outlook.",
            );
          }
          if (typeof query.state !== "string") {
            throw httpError(
              400,
              "CALENDAR_OAUTH_STATE_INVALID",
              "OAuth state is missing.",
            );
          }
          const stateHash = createHash("sha256")
            .update(query.state)
            .digest("hex");
          const stateResult = await database.query<OAuthStateRow>(
            `UPDATE mod_calendar.oauth_states
             SET used_at = now()
             WHERE state_hash = $1
               AND provider = $2
               AND used_at IS NULL
               AND expires_at > now()
             RETURNING
               id::text AS id,
               provider,
               household_id::text AS "householdId",
               context,
               code_verifier AS "codeVerifier",
               redirect_uri AS "redirectUri",
               return_to AS "returnTo",
               expires_at AS "expiresAt",
               used_at AS "usedAt"`,
            [stateHash, provider],
          );
          const state = stateResult.rows[0];
          if (!state) {
            throw httpError(
              400,
              "CALENDAR_OAUTH_STATE_INVALID",
              "OAuth state is invalid, expired, or already used.",
            );
          }
          if (typeof query.error === "string") {
            const description =
              typeof query.error_description === "string"
                ? query.error_description
                : query.error;
            return reply.redirect(
              `${state.returnTo}?calendarProviderError=${encodeURIComponent(description)}`,
            );
          }
          if (typeof query.code !== "string" || !query.code.trim()) {
            throw httpError(
              400,
              "CALENDAR_OAUTH_CODE_INVALID",
              "OAuth authorization code is missing.",
            );
          }
          const tokens = await exchangeOAuthCode(
            provider,
            query.code,
            state.codeVerifier,
            state.redirectUri,
          );
          if (!tokens.refreshToken) {
            throw httpError(
              400,
              "CALENDAR_OAUTH_REFRESH_TOKEN_MISSING",
              "The provider did not return an offline refresh token. Reconnect and grant offline Calendar access.",
            );
          }
          const connection = await createExternalConnection(
            host,
            state.context,
            {
              provider,
              accountLabel: providerLabel(provider),
              remoteCalendarId:
                provider === "google" ? "primary" : "default",
              secret: tokens.refreshToken,
            },
          );
          return reply.redirect(
            `${state.returnTo}?calendarProviderConnected=${encodeURIComponent(connection.provider)}`,
          );
        },
      );

      app.post(
        "/api/v1/modules/calendar/external/apple/discover",
        async (request) => {
          await requestContext(host, request);
          const body = request.body as Record<string, unknown> | null;
          if (
            !body ||
            typeof body.username !== "string" ||
            !body.username.trim() ||
            typeof body.password !== "string" ||
            !body.password
          ) {
            throw httpError(
              400,
              "CALENDAR_APPLE_CREDENTIALS_INVALID",
              "Apple account and app-specific password are required.",
            );
          }
          const endpointUrl =
            typeof body.endpointUrl === "string" && body.endpointUrl.trim()
              ? body.endpointUrl.trim()
              : "https://caldav.icloud.com/";
          const calendars = await discoverAppleCalendars(
            body.username.trim(),
            body.password,
            endpointUrl,
          );
          return { data: calendars };
        },
      );

      app.post(
        "/api/v1/modules/calendar/external/apple/connect",
        async (request) => {
          const context = await requestContext(host, request);
          const body = request.body as Record<string, unknown> | null;
          if (
            !body ||
            typeof body.username !== "string" ||
            !body.username.trim() ||
            typeof body.password !== "string" ||
            !body.password ||
            typeof body.calendarUrl !== "string" ||
            !body.calendarUrl.trim()
          ) {
            throw httpError(
              400,
              "CALENDAR_APPLE_CONNECTION_INVALID",
              "Apple account, app-specific password, and calendar URL are required.",
            );
          }
          const label =
            typeof body.label === "string" && body.label.trim()
              ? body.label.trim().slice(0, 200)
              : "Apple Calendar";
          const connection = await createExternalConnection(
            host,
            context,
            {
              provider: "apple",
              accountLabel: label,
              remoteCalendarId: body.calendarUrl.trim(),
              endpointUrl:
                typeof body.endpointUrl === "string" && body.endpointUrl.trim()
                  ? body.endpointUrl.trim()
                  : "https://caldav.icloud.com/",
              secret: JSON.stringify({
                username: body.username.trim(),
                password: body.password,
              }),
            },
          );
          return { data: externalConnectionState(connection) };
        },
      );

      app.post(
        "/api/v1/modules/calendar/external/connections/:connectionId/sync",
        async (request) => {
          const context = await requestContext(host, request);
          const params = request.params as { connectionId?: unknown };
          if (
            typeof params.connectionId !== "string" ||
            !UUID.test(params.connectionId)
          ) {
            throw httpError(
              400,
              "CALENDAR_CONNECTION_INVALID",
              "connectionId must be a UUID.",
            );
          }
          await syncExternalConnection(
            host,
            database,
            context,
            params.connectionId,
          );
          const row = await readExternalConnection(
            database,
            context,
            params.connectionId,
          );
          if (!row) {
            throw httpError(
              404,
              "CALENDAR_CONNECTION_NOT_FOUND",
              "External Calendar connection was not found.",
            );
          }
          return { data: externalConnectionState(row) };
        },
      );

      app.delete(
        "/api/v1/modules/calendar/external/connections/:connectionId",
        async (request) => {
          const context = await requestContext(host, request);
          const params = request.params as { connectionId?: unknown };
          if (
            typeof params.connectionId !== "string" ||
            !UUID.test(params.connectionId)
          ) {
            throw httpError(
              400,
              "CALENDAR_CONNECTION_INVALID",
              "connectionId must be a UUID.",
            );
          }
          const connectionId = params.connectionId;
          const atomic = host.atomic;
          if (!atomic) {
            throw new Error(
              "Calendar requires the Core atomic module-operation capability for external calendars.",
            );
          }

          await atomic.run(context, async (services) => {
            const tx = services.database;
            const syncPublisher = services.sync;
            const secrets = services.secrets;
            const jobs = services.jobs;
            if (!syncPublisher || !secrets || !jobs) {
              throw new Error(
                "Calendar external disconnect requires atomic sync, secrets, and jobs services.",
              );
            }
            const connection = await readExternalConnection(
              tx,
              context,
              connectionId,
            );
            if (!connection) {
              throw httpError(
                404,
                "CALENDAR_CONNECTION_NOT_FOUND",
                "External Calendar connection was not found.",
              );
            }

            const existing = await tx.query<EventRow>(
              `${EVENT_SELECT}
               WHERE household_id = $1::uuid
                 AND external_connection_id = $2::uuid
                 AND deleted_at IS NULL`,
              [context.householdId, connection.id],
            );
            for (const row of existing.rows) {
              const deleted = await tx.query<{ revision: string }>(
                `UPDATE mod_calendar.events
                 SET
                   deleted_at = now(),
                   revision = revision + 1,
                   updated_at = now(),
                   updated_by_user_id = $3::uuid
                 WHERE household_id = $1::uuid
                   AND id = $2::uuid
                 RETURNING revision::text AS revision`,
                [context.householdId, row.id, context.userId],
              );
              const revision = deleted.rows[0]?.revision;
              if (revision) {
                await syncPublisher.publish(context, {
                  entityType: "event",
                  entityId: row.id,
                  operation: "delete",
                  revision,
                });
              }
            }

            await tx.query(
              `UPDATE mod_calendar.external_connections
               SET
                 status = 'disabled',
                 revision = revision + 1,
                 updated_at = now()
               WHERE household_id = $1::uuid
                 AND id = $2::uuid`,
              [context.householdId, connection.id],
            );
            const layerUpdate = await tx.query<{ revision: string }>(
              `UPDATE mod_calendar.calendars
               SET
                 deleted_at = now(),
                 revision = revision + 1,
                 updated_at = now()
               WHERE household_id = $1::uuid
                 AND id = $2::uuid
               RETURNING revision::text AS revision`,
              [context.householdId, connection.calendarId],
            );
            const layerRevision = layerUpdate.rows[0]?.revision;
            if (!layerRevision) {
              throw new Error(
                "External Calendar layer removal returned no revision.",
              );
            }
            await syncPublisher.publish(context, {
              entityType: "calendar-layer",
              entityId: connection.calendarId,
              operation: "delete",
              revision: layerRevision,
            });
            await secrets.delete(
              context,
              externalSecretKey(connection.id),
            );
            await jobs.cancelByDedupeKey(
              context,
              `external-sync:${connection.id}`,
            );
          });

          return { data: { status: "disconnected" } };
        },
      );

      app.get(
        "/api/v1/modules/calendar/calendars",
        async (request) => {
          const context = await requestContext(host, request);
          await ensureInitialCalendar(database, context);
          const result = await database.query<CalendarRow>(
            `SELECT
               id::text AS id,
               household_id::text AS "householdId",
               name,
               color,
               kind,
               revision::text AS revision,
               created_at AS "createdAt",
               updated_at AS "updatedAt"
             FROM mod_calendar.calendars
             WHERE household_id = $1::uuid
               AND deleted_at IS NULL
             ORDER BY name, id`,
            [context.householdId],
          );
          return { data: result.rows.map(calendarState) };
        },
      );

      app.get(
        "/api/v1/modules/calendar/calendars/:calendarId",
        async (request) => {
          const context = await requestContext(host, request);
          const params = request.params as { calendarId?: unknown };
          if (
            typeof params.calendarId !== "string" ||
            !UUID.test(params.calendarId)
          ) {
            throw httpError(
              400,
              "CALENDAR_LAYER_INVALID",
              "calendarId must be a valid UUID.",
            );
          }
          const row = await findCalendarLayer(
            database,
            context,
            params.calendarId,
          );
          if (!row) {
            throw httpError(
              404,
              "CALENDAR_LAYER_NOT_FOUND",
              "Calendar was not found.",
            );
          }
          return { data: calendarState(row) };
        },
      );

      app.post(
        "/api/v1/modules/calendar/calendars",
        async (request) => {
          const context = await requestContext(host, request);
          const input = parseCalendarCreate(request.body);
          const result = await database.query<CalendarRow>(
            `INSERT INTO mod_calendar.calendars (
               id, household_id, name, color, kind, revision
             )
             VALUES ($1::uuid, $2::uuid, $3, $4, 'local', 1)
             RETURNING
               id::text AS id,
               household_id::text AS "householdId",
               name, color, kind,
               revision::text AS revision,
               created_at AS "createdAt",
               updated_at AS "updatedAt"`,
            [input.id, context.householdId, input.name, input.color],
          );
          const row = result.rows[0];
          if (!row) throw new Error("Calendar layer create returned no row.");
          return { data: { status: "saved", calendar: calendarState(row) } };
        },
      );

      app.put(
        "/api/v1/modules/calendar/calendars/:calendarId",
        async (request) => {
          const context = await requestContext(host, request);
          const params = request.params as { calendarId?: unknown };
          if (typeof params.calendarId !== "string" || !UUID.test(params.calendarId)) {
            throw httpError(400, "CALENDAR_LAYER_INVALID", "calendarId must be a valid UUID.");
          }
          const input = parseCalendarUpdate(request.body);
          const current = await database.query<CalendarRow>(
            `SELECT
               id::text AS id, household_id::text AS "householdId",
               name, color, kind, revision::text AS revision,
               created_at AS "createdAt", updated_at AS "updatedAt"
             FROM mod_calendar.calendars
             WHERE household_id = $1::uuid
               AND id = $2::uuid
               AND deleted_at IS NULL
             LIMIT 1`,
            [context.householdId, params.calendarId],
          );
          const row = current.rows[0];
          if (!row) throw httpError(404, "CALENDAR_LAYER_NOT_FOUND", "Calendar was not found.");
          if (row.revision !== input.baseRevision) {
            return { data: { status: "conflict", calendar: calendarState(row) } };
          }
          const updated = await database.query<CalendarRow>(
            `UPDATE mod_calendar.calendars
             SET name = $3, color = $4, revision = revision + 1, updated_at = now()
             WHERE household_id = $1::uuid AND id = $2::uuid
             RETURNING
               id::text AS id, household_id::text AS "householdId",
               name, color, kind, revision::text AS revision,
               created_at AS "createdAt", updated_at AS "updatedAt"`,
            [context.householdId, params.calendarId, input.name, input.color],
          );
          const saved = updated.rows[0];
          if (!saved) throw new Error("Calendar layer update returned no row.");
          return { data: { status: "saved", calendar: calendarState(saved) } };
        },
      );

      app.delete(
        "/api/v1/modules/calendar/calendars/:calendarId",
        async (request) => {
          const context = await requestContext(host, request);
          const params = request.params as { calendarId?: unknown };
          if (typeof params.calendarId !== "string" || !UUID.test(params.calendarId)) {
            throw httpError(400, "CALENDAR_LAYER_INVALID", "calendarId must be a valid UUID.");
          }
          const input = parseCalendarDelete(request.body);
          const current = await database.query<CalendarRow>(
            `SELECT
               id::text AS id, household_id::text AS "householdId",
               name, color, kind, revision::text AS revision,
               created_at AS "createdAt", updated_at AS "updatedAt"
             FROM mod_calendar.calendars
             WHERE household_id = $1::uuid
               AND id = $2::uuid
               AND deleted_at IS NULL
             LIMIT 1`,
            [context.householdId, params.calendarId],
          );
          const row = current.rows[0];
          if (!row) throw httpError(404, "CALENDAR_LAYER_NOT_FOUND", "Calendar was not found.");
          if (row.revision !== input.baseRevision) {
            return { data: { status: "conflict", calendar: calendarState(row) } };
          }
          const usage = await database.query(
            `SELECT 1 FROM mod_calendar.events
             WHERE household_id = $1::uuid
               AND calendar_id = $2::uuid
               AND deleted_at IS NULL
             LIMIT 1`,
            [context.householdId, params.calendarId],
          );
          if (usage.rows.length > 0) {
            throw httpError(409, "CALENDAR_LAYER_IN_USE", "Move or delete this calendar's events before removing it.");
          }
          const settings = await readSettings(database, context);
          if (settings?.defaultCalendarId === params.calendarId) {
            throw httpError(409, "CALENDAR_DEFAULT_IN_USE", "Choose another default calendar before removing this one.");
          }
          await database.query(
            `UPDATE mod_calendar.calendars
             SET deleted_at = now(), revision = revision + 1, updated_at = now()
             WHERE household_id = $1::uuid AND id = $2::uuid`,
            [context.householdId, params.calendarId],
          );
          return { data: { status: "deleted", calendar: calendarState(row) } };
        },
      );

      app.get(
        "/api/v1/modules/calendar/people",
        async (request) => {
          const context = await requestContext(host, request);
          const capability = host.householdPeople;
          if (!capability) {
            throw new Error(
              "Calendar requires household-people capability.",
            );
          }
          const people: readonly HomiHouseholdPerson[] =
            await capability.listActive(context);
          return { data: people };
        },
      );

      app.get(
        "/api/v1/modules/calendar/search",
        async (request) => {
          const context = await requestContext(host, request);
          const query = request.query as { q?: unknown; limit?: unknown };
          if (
            typeof query.q !== "string" ||
            query.q.trim().length < 1 ||
            query.q.trim().length > 200
          ) {
            throw httpError(400, "CALENDAR_SEARCH_INVALID", "Search requires 1 to 200 characters.");
          }
          const limit = query.limit === undefined
            ? 50
            : Number(query.limit);
          if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
            throw httpError(400, "CALENDAR_SEARCH_INVALID", "Search limit must be from 1 to 100.");
          }
          const capability = host.householdPeople;
          if (!capability) throw new Error("Calendar requires household-people capability.");
          const [people, rows] = await Promise.all([
            capability.listActive(context),
            database.query<EventRow>(
              `${EVENT_SELECT}
               WHERE household_id = $1::uuid
                 AND deleted_at IS NULL
               ORDER BY updated_at DESC, id`,
              [context.householdId],
            ),
          ]);
          const peopleById = new Map(people.map((person) => [person.id, person] as const));
          const normalized = query.q.trim().toLocaleLowerCase(context.locale);
          const results = rows.rows.flatMap((row) => {
            const event = eventState(row);
            const personIds = new Set(event.personIds);
            if (event.transport.pickupPersonId) personIds.add(event.transport.pickupPersonId);
            if (event.transport.dropoffPersonId) personIds.add(event.transport.dropoffPersonId);
            for (const override of event.recurrenceOverrides) {
              const replacement = override.replacement;
              if (!replacement) continue;
              for (const id of replacement.personIds) personIds.add(id);
              if (replacement.transport.pickupPersonId) personIds.add(replacement.transport.pickupPersonId);
              if (replacement.transport.dropoffPersonId) personIds.add(replacement.transport.dropoffPersonId);
            }
            const matchedPeople = [...personIds]
              .map((id) => peopleById.get(id))
              .filter((person): person is HomiHouseholdPerson => person !== undefined);
            const haystack = [
              event.title, event.description ?? "", event.notes ?? "",
              event.location ?? "",
              ...matchedPeople.map((person) => person.displayName),
            ].join("\n").toLocaleLowerCase(context.locale);
            return haystack.includes(normalized)
              ? [{ event, matchedPeople }]
              : [];
          }).slice(0, limit);
          return { data: { results } };
        },
      );

      app.get(
        "/api/v1/modules/calendar/events",
        async (request) => {
          const context = await requestContext(host, request);
          const result = await database.query<EventRow>(
            `${EVENT_SELECT}
             WHERE household_id = $1::uuid
               AND deleted_at IS NULL
             ORDER BY
               COALESCE(starts_at, start_date::timestamptz),
               title,
               id`,
            [context.householdId],
          );
          return {
            data: result.rows.map(eventState),
          };
        },
      );

      app.get(
        "/api/v1/modules/calendar/events/:eventId",
        async (request) => {
          const context = await requestContext(host, request);
          const params = request.params as {
            eventId?: unknown;
          };
          if (
            typeof params.eventId !== "string" ||
            !UUID.test(params.eventId)
          ) {
            throw httpError(
              400,
              "CALENDAR_EVENT_ID_INVALID",
              "eventId must be a valid UUID.",
            );
          }
          const event = await findEvent(
            database,
            context,
            params.eventId,
          );
          if (!event || event.deletedAt !== null) {
            throw httpError(
              404,
              "CALENDAR_EVENT_NOT_FOUND",
              "The Calendar event was not found.",
            );
          }
          return { data: eventState(event) };
        },
      );
    },

    async getSetupStatus(context: HomiRequestContext) {
      const settings = await readSettings(database, context);
      return {
        state:
          settings?.state === "configured"
            ? "configured"
            : "unconfigured",
      } as const;
    },

    jobs: {
      handlers: [
        {
          jobType: "event-reminder",
          async handle(context, payload) {
            await deliverEventReminder(
              host,
              database,
              context,
              payload,
            );
          },
        },
        {
          jobType: "external-sync",
          async handle(context, payload) {
            const connectionId = payload.connectionId;
            if (typeof connectionId !== "string" || !UUID.test(connectionId)) {
              throw new Error("Calendar external-sync job has an invalid connection ID.");
            }
            await syncExternalConnection(
              host,
              database,
              context,
              connectionId,
            );
          },
        },
      ],
    },

    broker: {
      providers: [
        {
          capability: "calendar.range.v1",
          async handle(context, invocation) {
            if (invocation.action !== "list-occurrences") {
              throw httpError(
                400,
                "CALENDAR_BROKER_ACTION_UNSUPPORTED",
                "Unsupported Calendar range broker action.",
              );
            }
            return brokerRange(database, context, invocation.payload);
          },
        },
        {
          capability: "calendar.transport.v1",
          async handle(context, invocation) {
            if (invocation.action !== "get-event-transport") {
              throw httpError(
                400,
                "CALENDAR_BROKER_ACTION_UNSUPPORTED",
                "Unsupported Calendar transportation broker action.",
              );
            }
            return brokerTransport(database, context, invocation.payload);
          },
        },
        {
          capability: "calendar.linked-events.v1",
          handle(context, invocation) {
            return brokerLinkedEvents(
              host,
              database,
              context,
              invocation,
            );
          },
        },
      ],
    },

    sync: {
      mutationHandlers: [
        {
          entityType: "event",
          operations: ["create", "update", "delete"],
          apply(context, database, input, services) {
            return applyEventMutation(
              host,
              context,
              database,
              input,
              services,
            );
          },
        },
        {
          entityType: "calendar-layer",
          operations: ["create", "update", "delete"],
          apply: applyCalendarLayerMutation,
        },
        {
          entityType: "calendar-settings",
          operations: ["update"],
          apply: applyCalendarSettingsMutation,
        },
      ],
    },
  });
}
