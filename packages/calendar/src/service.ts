import { createHash } from "node:crypto";
import {
  and,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import {
  auditLog,
  changeLog,
  eventOutbox,
  householdModules,
  householdPeople,
  modules,
  syncMutations,
  type HomiDatabase,
} from "@homi/db";
import type { HomiRequestContext } from "@homi/module-sdk";
import {
  isCalendarSettingsWrite,
  unconfiguredCalendarSettings,
  validTimeZone,
  type CalendarSettings,
  type CalendarSettingsWrite,
  type CalendarSettingsResult,
} from "./settings.js";
import { isLegacyV53EventPayload } from "./event-validation.js";
import { recurrenceOccursOn } from "./recurrence.js";
import type {
  CalendarLayer,
  CalendarLayerCreate,
  CalendarLayerDelete,
  CalendarLayerDeleteResult,
  CalendarLayerUpdate,
  CalendarLayerWriteResult,
} from "./calendars.js";
import {
  calendarCalendars,
  calendarEvents,
  calendarSettings,
} from "./schema.js";
import type {
  CalendarEvent,
  CalendarEventPayload,
  CalendarEventRange,
  CalendarMutationInput,
  CalendarMutationResult,
  CalendarPerson,
  CalendarSearchResult,
  CalendarRecurrenceRule,
  CalendarOccurrenceOverride,
  CalendarTransportContext,
} from "./types.js";

type CalendarEventRow = typeof calendarEvents.$inferSelect;
type CalendarLayerRow = typeof calendarCalendars.$inferSelect;
type CalendarTransaction = Parameters<Parameters<HomiDatabase["db"]["transaction"]>[0]>[0];

interface MutationRow {
  clientMutationId: string;
  status: CalendarMutationResult["status"];
  serverRevision: bigint | null;
  changeSequence: bigint | null;
  errorCode: string | null;
  requestHash: string | null;
  resultPayload: unknown;
}

interface NormalizedEventState {
  calendarId: string;
  title: string;
  description: string | null;
  allDay: boolean;
  timeZone: string;
  startsAt: Date;
  endsAt: Date;
  startDate: string | null;
  endDateExclusive: string | null;
  location: string | null;
  notes: string | null;
  recurrence: CalendarRecurrenceRule | null;
  recurrenceOverrides: readonly CalendarOccurrenceOverride[];
  personIds: readonly string[];
  reminderMinutes: readonly number[];
  transport: CalendarTransportContext;
}

export class CalendarServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CalendarServiceError";
  }
}

export interface CalendarService {
  getSettings(context: HomiRequestContext): Promise<CalendarSettings>;
  saveSettings(
    context: HomiRequestContext,
    input: CalendarSettingsWrite,
  ): Promise<CalendarSettingsResult>;
  listCalendars(context: HomiRequestContext): Promise<CalendarLayer[]>;
  getCalendar(context: HomiRequestContext, calendarId: string): Promise<CalendarLayer>;
  createCalendar(
    context: HomiRequestContext,
    input: CalendarLayerCreate,
  ): Promise<CalendarLayerWriteResult>;
  updateCalendar(
    context: HomiRequestContext,
    calendarId: string,
    input: CalendarLayerUpdate,
  ): Promise<CalendarLayerWriteResult>;
  deleteCalendar(
    context: HomiRequestContext,
    calendarId: string,
    input: CalendarLayerDelete,
  ): Promise<CalendarLayerDeleteResult>;
  listEvents(
    context: HomiRequestContext,
    range: CalendarEventRange,
  ): Promise<CalendarEvent[]>;
  getEvent(context: HomiRequestContext, eventId: string): Promise<CalendarEvent>;
  listPeople(context: HomiRequestContext): Promise<CalendarPerson[]>;
  searchEvents(
    context: HomiRequestContext,
    query: string,
    limit: number,
  ): Promise<CalendarSearchResult[]>;
  applyMutation(
    context: HomiRequestContext,
    input: CalendarMutationInput,
  ): Promise<CalendarMutationResult>;
}

function layerFromRow(row: CalendarLayerRow): CalendarLayer {
  return {
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    color: row.color,
    kind: row.kind,
    revision: row.revision.toString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function eventFromRow(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    householdId: row.householdId,
    calendarId: row.calendarId,
    title: row.title,
    description: row.description,
    allDay: row.allDay,
    timeZone: row.timeZone,
    startsAt: row.allDay ? null : row.startsAt.toISOString(),
    endsAt: row.allDay ? null : row.endsAt.toISOString(),
    startDate: row.allDay ? row.startDate : null,
    endDateExclusive: row.allDay ? row.endDateExclusive : null,
    location: row.location,
    notes: row.notes,
    recurrence: row.recurrence,
    recurrenceOverrides: row.recurrenceOverrides,
    personIds: row.personIds,
    reminderMinutes: row.reminderMinutes,
    transport: row.transport,
    revision: row.revision.toString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mutationResult(row: MutationRow, replayed: boolean): CalendarMutationResult {
  return {
    clientMutationId: row.clientMutationId,
    status: row.status,
    serverRevision: row.serverRevision?.toString() ?? null,
    changeSequence: row.changeSequence?.toString() ?? null,
    errorCode: row.errorCode,
    serverState: row.resultPayload === null ? null : row.resultPayload as CalendarEvent,
    replayed,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) output[key] = canonicalize(input[key]);
    return output;
  }
  return value;
}

function requestHash(context: HomiRequestContext, input: CalendarMutationInput): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize({
      householdId: context.householdId,
      moduleKey: input.moduleKey,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      baseRevision: input.baseRevision.toString(),
      payload: input.payload,
    })))
    .digest("hex");
}

function requireClientId(context: HomiRequestContext): string {
  if (!context.clientId) {
    throw new CalendarServiceError(400, "CLIENT_REQUIRED", "X-Homi-Client-ID is required for Calendar writes.");
  }
  return context.clientId;
}

function validDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month! - 1
    && parsed.getUTCDate() === day;
}

function validateInstantRange(startsAt: Date, endsAt: Date): void {
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
    throw new CalendarServiceError(400, "CALENDAR_INVALID_RANGE", "Calendar event end time must be after its start time.");
  }
}

function dateProjection(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function localDateForInstant(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return String(fields.year) + "-" + String(fields.month) + "-" + String(fields.day);
}

function validateRecurrenceState(state: NormalizedEventState): NormalizedEventState {
  if (state.recurrence === null) {
    if (state.recurrenceOverrides.length !== 0) {
      throw new CalendarServiceError(
        400,
        "CALENDAR_RECURRENCE_OVERRIDES_WITHOUT_SERIES",
        "Occurrence overrides require a recurring event.",
      );
    }
    return state;
  }
  const anchor = state.allDay
    ? state.startDate!
    : localDateForInstant(state.startsAt, state.timeZone);
  if (state.recurrence.endDate !== null && state.recurrence.endDate < anchor) {
    throw new CalendarServiceError(
      400,
      "CALENDAR_RECURRENCE_END_BEFORE_START",
      "Recurrence end date cannot be before the first occurrence.",
    );
  }
  if (!recurrenceOccursOn(anchor, state.recurrence, anchor)) {
    throw new CalendarServiceError(
      400,
      "CALENDAR_RECURRENCE_EXCLUDES_START",
      "The recurrence rule must include the event's first occurrence.",
    );
  }
  for (const override of state.recurrenceOverrides) {
    if (!recurrenceOccursOn(anchor, state.recurrence, override.occurrenceDate)) {
      throw new CalendarServiceError(
        400,
        "CALENDAR_RECURRENCE_OVERRIDE_INVALID",
        "Occurrence overrides must target dates produced by the recurrence rule.",
      );
    }
  }
  return state;
}

function normalizeEventState(
  payload: CalendarEventPayload,
  current?: CalendarEventRow,
): NormalizedEventState {
  const calendarId = payload.calendarId ?? current?.calendarId;
  const title = payload.title ?? current?.title;
  const allDay = payload.allDay ?? current?.allDay;
  const timeZone = payload.timeZone ?? current?.timeZone;
  if (!calendarId || !title || allDay === undefined || !validTimeZone(timeZone)) {
    throw new CalendarServiceError(400, "CALENDAR_INVALID_EVENT", "Calendar event identity, title, allDay and a valid IANA timeZone are required.");
  }

  const location = Object.hasOwn(payload, "location")
    ? payload.location ?? null
    : current?.location ?? null;
  const notes = Object.hasOwn(payload, "notes")
    ? payload.notes ?? null
    : current?.notes ?? null;
  const description = Object.hasOwn(payload, "description")
    ? payload.description ?? null
    : current?.description ?? null;
  const recurrence = Object.hasOwn(payload, "recurrence")
    ? payload.recurrence ?? null
    : current?.recurrence ?? null;
  const recurrenceOverrides = Object.hasOwn(payload, "recurrenceOverrides")
    ? payload.recurrenceOverrides ?? []
    : Object.hasOwn(payload, "recurrence") && payload.recurrence === null
      ? []
      : current?.recurrenceOverrides ?? [];
  const personIds = Object.hasOwn(payload, "personIds")
    ? payload.personIds ?? []
    : current?.personIds ?? [];
  const reminderMinutes = Object.hasOwn(payload, "reminderMinutes")
    ? payload.reminderMinutes ?? []
    : current?.reminderMinutes ?? [];
  const transport = Object.hasOwn(payload, "transport")
    ? payload.transport!
    : current?.transport ?? { mode: "none", pickupPersonId: null, dropoffPersonId: null, notes: null };

  if (allDay) {
    if ((Object.hasOwn(payload, "startsAt") && payload.startsAt !== null)
      || (Object.hasOwn(payload, "endsAt") && payload.endsAt !== null)) {
      throw new CalendarServiceError(400, "CALENDAR_MIXED_TIME_SHAPE", "All-day events cannot contain timed startsAt/endsAt values.");
    }
    const startDate = Object.hasOwn(payload, "startDate")
      ? payload.startDate
      : current?.allDay ? current.startDate : null;
    const endDateExclusive = Object.hasOwn(payload, "endDateExclusive")
      ? payload.endDateExclusive
      : current?.allDay ? current.endDateExclusive : null;
    if (!validDateOnly(startDate) || !validDateOnly(endDateExclusive) || endDateExclusive <= startDate) {
      throw new CalendarServiceError(400, "CALENDAR_INVALID_ALL_DAY_RANGE", "All-day events require valid startDate and later endDateExclusive dates.");
    }
    return validateRecurrenceState({
      calendarId,
      title,
      description,
      allDay: true,
      timeZone,
      startsAt: dateProjection(startDate),
      endsAt: dateProjection(endDateExclusive),
      startDate,
      endDateExclusive,
      location,
      notes,
      recurrence,
      recurrenceOverrides,
      personIds,
      reminderMinutes,
      transport,
    });
  }

  if ((Object.hasOwn(payload, "startDate") && payload.startDate !== null)
    || (Object.hasOwn(payload, "endDateExclusive") && payload.endDateExclusive !== null)) {
    throw new CalendarServiceError(400, "CALENDAR_MIXED_TIME_SHAPE", "Timed events cannot contain all-day date values.");
  }
  const startsAtValue = Object.hasOwn(payload, "startsAt")
    ? payload.startsAt
    : current && !current.allDay ? current.startsAt.toISOString() : null;
  const endsAtValue = Object.hasOwn(payload, "endsAt")
    ? payload.endsAt
    : current && !current.allDay ? current.endsAt.toISOString() : null;
  if (typeof startsAtValue !== "string" || typeof endsAtValue !== "string") {
    throw new CalendarServiceError(400, "CALENDAR_INVALID_TIMED_RANGE", "Timed events require startsAt and endsAt instants.");
  }
  const startsAt = new Date(startsAtValue);
  const endsAt = new Date(endsAtValue);
  validateInstantRange(startsAt, endsAt);
  return validateRecurrenceState({
    calendarId,
    title,
    description,
    allDay: false,
    timeZone,
    startsAt,
    endsAt,
    startDate: null,
    endDateExclusive: null,
    location,
    notes,
    recurrence,
    recurrenceOverrides,
    personIds,
    reminderMinutes,
    transport,
  });
}

async function requireActiveEventPeople(
  tx: CalendarTransaction,
  householdId: string,
  state: NormalizedEventState,
): Promise<void> {
  const calendarIds = new Set<string>([state.calendarId]);
  const ids = new Set<string>(state.personIds);
  const addTransportPeople = (transport: CalendarTransportContext) => {
    if (transport.pickupPersonId) ids.add(transport.pickupPersonId);
    if (transport.dropoffPersonId) ids.add(transport.dropoffPersonId);
  };
  addTransportPeople(state.transport);
  for (const override of state.recurrenceOverrides) {
    if (override.action !== "replace" || !override.replacement) continue;
    calendarIds.add(override.replacement.calendarId);
    for (const personId of override.replacement.personIds) ids.add(personId);
    addTransportPeople(override.replacement.transport);
  }

  const activeLayers = await tx
    .select({ id: calendarCalendars.id })
    .from(calendarCalendars)
    .where(and(
      eq(calendarCalendars.householdId, householdId),
      isNull(calendarCalendars.deletedAt),
      inArray(calendarCalendars.id, [...calendarIds]),
    ));
  if (activeLayers.length !== calendarIds.size) {
    throw new CalendarServiceError(
      400,
      "CALENDAR_LAYER_NOT_FOUND",
      "Event and occurrence calendars must be active in this household.",
    );
  }

  if (ids.size === 0) return;
  const rows = await tx
    .select({ id: householdPeople.id })
    .from(householdPeople)
    .where(and(
      eq(householdPeople.householdId, householdId),
      eq(householdPeople.status, "active"),
      inArray(householdPeople.id, [...ids]),
    ));
  if (rows.length !== ids.size) {
    throw new CalendarServiceError(
      400,
      "CALENDAR_PERSON_INVALID",
      "Calendar people and transportation assignments must reference active people in this household.",
    );
  }
}

async function requireEnabled(database: HomiDatabase["db"], householdId: string): Promise<void> {
  const [enabled] = await database
    .select({ moduleId: modules.id })
    .from(householdModules)
    .innerJoin(modules, eq(modules.id, householdModules.moduleId))
    .where(and(
      eq(householdModules.householdId, householdId),
      eq(householdModules.enabled, true),
      eq(modules.moduleKey, "calendar"),
      eq(modules.state, "installed"),
    ))
    .limit(1);
  if (!enabled) throw new CalendarServiceError(404, "CALENDAR_MODULE_UNAVAILABLE", "Calendar is not enabled for this household.");
}

async function ensureInitialCalendar(
  database: HomiDatabase["db"],
  context: HomiRequestContext,
): Promise<CalendarLayerRow> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"calendar.initial:" + context.householdId}, 0))`);
    const [existing] = await tx
      .select()
      .from(calendarCalendars)
      .where(and(
        eq(calendarCalendars.householdId, context.householdId),
        isNull(calendarCalendars.deletedAt),
      ))
      .orderBy(calendarCalendars.createdAt, calendarCalendars.id)
      .limit(1);
    if (existing) return existing;

    const [created] = await tx
      .insert(calendarCalendars)
      .values({
        householdId: context.householdId,
        name: "Household",
        color: "blue",
        kind: "local",
        revision: 1n,
      })
      .returning();
    if (!created) {
      throw new CalendarServiceError(
        500,
        "CALENDAR_INITIAL_LAYER_FAILED",
        "The initial household calendar could not be created.",
      );
    }
    const snapshot = layerFromRow(created);
    await tx.insert(changeLog).values({
      householdId: context.householdId,
      moduleKey: "calendar",
      entityType: "calendar",
      entityId: created.id,
      operation: "create",
      revision: created.revision,
      changedByUserId: context.userId,
      clientId: context.clientId,
    });
    await tx.insert(auditLog).values({
      householdId: context.householdId,
      actorUserId: context.userId,
      actorClientId: context.clientId,
      action: "calendar.layer.initialized",
      targetType: "calendar.layer",
      targetId: created.id,
      sourceModuleKey: "calendar",
      requestId: context.requestId,
      metadata: { revision: snapshot.revision },
    });
    await tx.insert(eventOutbox).values({
      householdId: context.householdId,
      sourceModuleKey: "calendar",
      eventType: "calendar.layer.initialized",
      aggregateType: "calendar.layer",
      aggregateId: created.id,
      payload: snapshot,
    });
    return created;
  });
}

const mutationReturning = {
  clientMutationId: syncMutations.clientMutationId,
  status: syncMutations.status,
  serverRevision: syncMutations.serverRevision,
  changeSequence: syncMutations.changeSequence,
  errorCode: syncMutations.errorCode,
  requestHash: syncMutations.requestHash,
  resultPayload: syncMutations.resultPayload,
};

export function createCalendarService(database: HomiDatabase["db"]): CalendarService {
  return {
    async getSettings(context) {
      await requireEnabled(database, context.householdId);
      const [row] = await database.select().from(calendarSettings)
        .where(eq(calendarSettings.householdId, context.householdId));
      if (row) return { ...row, revision: row.revision.toString() };
      const defaultCalendar = await ensureInitialCalendar(database, context);
      return unconfiguredCalendarSettings(context.householdId, context.timeZone, defaultCalendar.id);
    },

    async saveSettings(context, input) {
      if (!isCalendarSettingsWrite(input)) throw new CalendarServiceError(400, "VALIDATION_FAILED", "Invalid Calendar settings.");
      await requireEnabled(database, context.householdId);
      const clientId = requireClientId(context);
      return database.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"calendar.settings:" + context.householdId}, 0))`);
        const [defaultCalendar] = await tx.select().from(calendarCalendars).where(and(
          eq(calendarCalendars.id, input.defaultCalendarId),
          eq(calendarCalendars.householdId, context.householdId),
          isNull(calendarCalendars.deletedAt),
        )).limit(1);
        if (!defaultCalendar) throw new CalendarServiceError(400, "CALENDAR_DEFAULT_INVALID", "The default calendar is not active in this household.");
        const [row] = await tx.select().from(calendarSettings)
          .where(eq(calendarSettings.householdId, context.householdId)).limit(1).for("update");
        const current = row
          ? { ...row, revision: row.revision.toString() }
          : unconfiguredCalendarSettings(context.householdId, context.timeZone, defaultCalendar.id);
        if (current.revision !== input.baseRevision) return { status: "conflict", settings: current };
        if (current.state === "configured" && input.state === "unconfigured") {
          throw new CalendarServiceError(400, "VALIDATION_FAILED", "Configured Calendar cannot return to draft setup.");
        }
        const { baseRevision, ...preferences } = input;
        const revision = BigInt(baseRevision) + 1n;
        const [saved] = await tx.insert(calendarSettings).values({ ...preferences, householdId: context.householdId, revision })
          .onConflictDoUpdate({ target: calendarSettings.householdId, set: { ...preferences, revision } }).returning();
        if (!saved) throw new CalendarServiceError(500, "CALENDAR_SETTINGS_FAILED", "Settings could not be saved.");
        const settings = { ...saved, revision: saved.revision.toString() };
        await tx.insert(changeLog).values({ householdId: context.householdId, moduleKey: "calendar", entityType: "settings", entityId: context.householdId, operation: row ? "update" : "create", revision, changedByUserId: context.userId, clientId });
        await tx.insert(auditLog).values({ householdId: context.householdId, actorUserId: context.userId, actorClientId: clientId, action: "calendar.settings.saved", targetType: "calendar.settings", targetId: context.householdId, sourceModuleKey: "calendar", requestId: context.requestId, metadata: { revision: settings.revision, state: settings.state } });
        await tx.insert(eventOutbox).values({ householdId: context.householdId, sourceModuleKey: "calendar", eventType: "calendar.settings.saved", aggregateType: "calendar.settings", aggregateId: context.householdId, payload: settings });
        return { status: "saved", settings };
      });
    },

    async listCalendars(context) {
      await requireEnabled(database, context.householdId);
      const rows = await database.select().from(calendarCalendars)
        .where(and(eq(calendarCalendars.householdId, context.householdId), isNull(calendarCalendars.deletedAt)))
        .orderBy(calendarCalendars.createdAt, calendarCalendars.id);
      if (rows.length > 0) return rows.map(layerFromRow);
      return [layerFromRow(await ensureInitialCalendar(database, context))];
    },

    async getCalendar(context, calendarId) {
      await requireEnabled(database, context.householdId);
      const [row] = await database.select().from(calendarCalendars).where(and(
        eq(calendarCalendars.id, calendarId), eq(calendarCalendars.householdId, context.householdId), isNull(calendarCalendars.deletedAt),
      )).limit(1);
      if (!row) throw new CalendarServiceError(404, "CALENDAR_LAYER_NOT_FOUND", "The calendar was not found.");
      return layerFromRow(row);
    },

    async createCalendar(context, input) {
      await requireEnabled(database, context.householdId);
      const clientId = requireClientId(context);
      return database.transaction(async (tx) => {
        const [existing] = await tx.select().from(calendarCalendars).where(and(
          eq(calendarCalendars.id, input.id), eq(calendarCalendars.householdId, context.householdId),
        )).limit(1).for("update");
        if (existing) {
          if (existing.deletedAt) throw new CalendarServiceError(409, "CALENDAR_LAYER_ID_REUSED", "Calendar IDs are never reused.");
          return { status: "conflict", calendar: layerFromRow(existing) };
        }
        const now = new Date();
        const [created] = await tx.insert(calendarCalendars).values({
          id: input.id, householdId: context.householdId, name: input.name.trim(), color: input.color,
          kind: "local", revision: 1n, createdAt: now, updatedAt: now,
        }).returning();
        if (!created) throw new CalendarServiceError(500, "CALENDAR_LAYER_CREATE_FAILED", "The calendar could not be created.");
        const snapshot = layerFromRow(created);
        const [change] = await tx.insert(changeLog).values({ householdId: context.householdId, moduleKey: "calendar", entityType: "calendar", entityId: created.id, operation: "create", revision: created.revision, changedByUserId: context.userId, clientId }).returning({ sequence: changeLog.sequence });
        if (!change) throw new CalendarServiceError(500, "CHANGE_LOG_FAILED", "The calendar change could not be recorded.");
        await tx.insert(auditLog).values({ householdId: context.householdId, actorUserId: context.userId, actorClientId: clientId, action: "calendar.layer.created", targetType: "calendar.layer", targetId: created.id, sourceModuleKey: "calendar", requestId: context.requestId, metadata: { revision: snapshot.revision } });
        await tx.insert(eventOutbox).values({ householdId: context.householdId, sourceModuleKey: "calendar", eventType: "calendar.layer.created", aggregateType: "calendar.layer", aggregateId: created.id, payload: snapshot });
        return { status: "saved", calendar: snapshot };
      });
    },

    async updateCalendar(context, calendarId, input) {
      await requireEnabled(database, context.householdId);
      const clientId = requireClientId(context);
      return database.transaction(async (tx) => {
        const [current] = await tx.select().from(calendarCalendars).where(and(
          eq(calendarCalendars.id, calendarId), eq(calendarCalendars.householdId, context.householdId), isNull(calendarCalendars.deletedAt),
        )).limit(1).for("update");
        if (!current) throw new CalendarServiceError(404, "CALENDAR_LAYER_NOT_FOUND", "The calendar was not found.");
        if (current.revision !== BigInt(input.baseRevision)) return { status: "conflict", calendar: layerFromRow(current) };
        const [updated] = await tx.update(calendarCalendars).set({ name: input.name.trim(), color: input.color, revision: current.revision + 1n, updatedAt: new Date() })
          .where(and(eq(calendarCalendars.id, calendarId), eq(calendarCalendars.householdId, context.householdId), isNull(calendarCalendars.deletedAt))).returning();
        if (!updated) throw new CalendarServiceError(409, "CALENDAR_LAYER_CHANGED", "The calendar changed before update.");
        const snapshot = layerFromRow(updated);
        await tx.insert(changeLog).values({ householdId: context.householdId, moduleKey: "calendar", entityType: "calendar", entityId: calendarId, operation: "update", revision: updated.revision, changedByUserId: context.userId, clientId });
        await tx.insert(auditLog).values({ householdId: context.householdId, actorUserId: context.userId, actorClientId: clientId, action: "calendar.layer.updated", targetType: "calendar.layer", targetId: calendarId, sourceModuleKey: "calendar", requestId: context.requestId, metadata: { revision: snapshot.revision } });
        await tx.insert(eventOutbox).values({ householdId: context.householdId, sourceModuleKey: "calendar", eventType: "calendar.layer.updated", aggregateType: "calendar.layer", aggregateId: calendarId, payload: snapshot });
        return { status: "saved", calendar: snapshot };
      });
    },

    async deleteCalendar(context, calendarId, input) {
      await requireEnabled(database, context.householdId);
      const clientId = requireClientId(context);
      return database.transaction(async (tx) => {
        const [current] = await tx.select().from(calendarCalendars).where(and(
          eq(calendarCalendars.id, calendarId), eq(calendarCalendars.householdId, context.householdId), isNull(calendarCalendars.deletedAt),
        )).limit(1).for("update");
        if (!current) throw new CalendarServiceError(404, "CALENDAR_LAYER_NOT_FOUND", "The calendar was not found.");
        if (current.revision !== BigInt(input.baseRevision)) return { status: "conflict", calendar: layerFromRow(current) };
        const [settings] = await tx.select({ defaultCalendarId: calendarSettings.defaultCalendarId }).from(calendarSettings)
          .where(eq(calendarSettings.householdId, context.householdId)).limit(1).for("update");
        if (settings?.defaultCalendarId === calendarId) throw new CalendarServiceError(409, "CALENDAR_DEFAULT_LAYER", "The default calendar cannot be deleted.");
        const active = await tx.select({ id: calendarCalendars.id }).from(calendarCalendars)
          .where(and(eq(calendarCalendars.householdId, context.householdId), isNull(calendarCalendars.deletedAt))).limit(2);
        if (active.length <= 1) throw new CalendarServiceError(409, "CALENDAR_LAST_LAYER", "The last active calendar cannot be deleted.");
        const [activeEvent] = await tx.select({ id: calendarEvents.id }).from(calendarEvents)
          .where(and(
            eq(calendarEvents.householdId, context.householdId),
            eq(calendarEvents.calendarId, calendarId),
            isNull(calendarEvents.deletedAt),
          )).limit(1);
        if (activeEvent) {
          throw new CalendarServiceError(
            409,
            "CALENDAR_LAYER_NOT_EMPTY",
            "Move or delete this calendar's events before deleting it.",
          );
        }
        const [deleted] = await tx.update(calendarCalendars).set({ revision: current.revision + 1n, deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(calendarCalendars.id, calendarId), eq(calendarCalendars.householdId, context.householdId), isNull(calendarCalendars.deletedAt))).returning();
        if (!deleted) throw new CalendarServiceError(409, "CALENDAR_LAYER_CHANGED", "The calendar changed before deletion.");
        const snapshot = layerFromRow(deleted);
        await tx.insert(changeLog).values({ householdId: context.householdId, moduleKey: "calendar", entityType: "calendar", entityId: calendarId, operation: "delete", revision: deleted.revision, changedByUserId: context.userId, clientId });
        await tx.insert(auditLog).values({ householdId: context.householdId, actorUserId: context.userId, actorClientId: clientId, action: "calendar.layer.deleted", targetType: "calendar.layer", targetId: calendarId, sourceModuleKey: "calendar", requestId: context.requestId, metadata: { revision: snapshot.revision } });
        await tx.insert(eventOutbox).values({ householdId: context.householdId, sourceModuleKey: "calendar", eventType: "calendar.layer.deleted", aggregateType: "calendar.layer", aggregateId: calendarId, payload: { id: calendarId, revision: snapshot.revision } });
        return { status: "deleted", calendar: snapshot };
      });
    },

    async listEvents(context, range) {
      await requireEnabled(database, context.householdId);
      const rows = await database.select().from(calendarEvents).where(and(
        eq(calendarEvents.householdId, context.householdId),
        isNull(calendarEvents.deletedAt),
        or(
          sql`${calendarEvents.recurrence} is not null`,
          and(lt(calendarEvents.startsAt, range.to), gt(calendarEvents.endsAt, range.from)),
        ),
      )).orderBy(calendarEvents.startsAt, calendarEvents.endsAt, calendarEvents.id);
      return rows.map(eventFromRow);
    },

    async getEvent(context, eventId) {
      await requireEnabled(database, context.householdId);
      const [row] = await database.select().from(calendarEvents).where(and(
        eq(calendarEvents.id, eventId), eq(calendarEvents.householdId, context.householdId), isNull(calendarEvents.deletedAt),
      )).limit(1);
      if (!row) throw new CalendarServiceError(404, "CALENDAR_EVENT_NOT_FOUND", "The Calendar event was not found.");
      return eventFromRow(row);
    },

    async listPeople(context) {
      await requireEnabled(database, context.householdId);
      const rows = await database
        .select({
          id: householdPeople.id,
          displayName: householdPeople.displayName,
          avatarFileId: householdPeople.avatarFileId,
        })
        .from(householdPeople)
        .where(and(
          eq(householdPeople.householdId, context.householdId),
          eq(householdPeople.status, "active"),
        ))
        .orderBy(householdPeople.displayName, householdPeople.id);
      return rows.map((row) => ({ ...row }));
    },

    async searchEvents(context, query, limit) {
      await requireEnabled(database, context.householdId);
      const needle = query.trim().toLocaleLowerCase(context.locale);
      if (needle.length < 1 || needle.length > 200 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new CalendarServiceError(400, "CALENDAR_SEARCH_INVALID", "Calendar search requires a query and a limit from 1 to 100.");
      }
      const [events, people] = await Promise.all([
        database.select().from(calendarEvents).where(and(
          eq(calendarEvents.householdId, context.householdId),
          isNull(calendarEvents.deletedAt),
        )).orderBy(calendarEvents.startsAt, calendarEvents.id),
        database.select({ id: householdPeople.id, displayName: householdPeople.displayName, avatarFileId: householdPeople.avatarFileId })
          .from(householdPeople)
          .where(and(eq(householdPeople.householdId, context.householdId), eq(householdPeople.status, "active"))),
      ]);
      const peopleMap = new Map(people.map((person) => [person.id, person]));
      const results: CalendarSearchResult[] = [];
      for (const row of events) {
        const event = eventFromRow(row);
        const relatedPersonIds = new Set(event.personIds);
        if (event.transport.pickupPersonId) relatedPersonIds.add(event.transport.pickupPersonId);
        if (event.transport.dropoffPersonId) relatedPersonIds.add(event.transport.dropoffPersonId);
        const overrideText: string[] = [];
        for (const override of event.recurrenceOverrides) {
          if (override.action !== "replace" || !override.replacement) continue;
          overrideText.push(
            override.replacement.title,
            override.replacement.description ?? "",
            override.replacement.notes ?? "",
            override.replacement.location ?? "",
          );
          for (const id of override.replacement.personIds) relatedPersonIds.add(id);
          if (override.replacement.transport.pickupPersonId) relatedPersonIds.add(override.replacement.transport.pickupPersonId);
          if (override.replacement.transport.dropoffPersonId) relatedPersonIds.add(override.replacement.transport.dropoffPersonId);
        }
        const matchedPeople = [...relatedPersonIds]
          .map((id) => peopleMap.get(id))
          .filter((person): person is CalendarPerson => person !== undefined);
        const haystack = [
          event.title,
          event.description ?? "",
          event.notes ?? "",
          event.location ?? "",
          ...overrideText,
          ...matchedPeople.map((person) => person.displayName),
        ].join("\n").toLocaleLowerCase(context.locale);
        if (haystack.includes(needle)) {
          results.push({ event, matchedPeople });
          if (results.length >= limit) break;
        }
      }
      return results;
    },

    async applyMutation(context, input) {
      await requireEnabled(database, context.householdId);
      const clientId = requireClientId(context);
      const hash = requestHash(context, input);
      return database.transaction(async (tx) => {
        const [receipt] = await tx.insert(syncMutations).values({
          clientId, householdId: context.householdId, clientMutationId: input.clientMutationId,
          moduleKey: "calendar", entityType: "event", entityId: input.entityId,
          baseRevision: input.baseRevision, requestHash: hash, status: "received",
        }).onConflictDoNothing({ target: [syncMutations.clientId, syncMutations.clientMutationId] }).returning(mutationReturning);
        if (!receipt) {
          const [replay] = await tx.select(mutationReturning).from(syncMutations).where(and(
            eq(syncMutations.clientId, clientId), eq(syncMutations.clientMutationId, input.clientMutationId),
          )).limit(1);
          if (!replay) throw new CalendarServiceError(500, "MUTATION_REPLAY_FAILED", "The prior Calendar mutation result could not be read.");
          if (!replay.requestHash) throw new CalendarServiceError(409, "MUTATION_ID_UNVERIFIABLE", "This legacy mutation ID cannot be safely replayed.");
          if (replay.requestHash !== hash) throw new CalendarServiceError(409, "MUTATION_ID_REUSED", "clientMutationId was already used for a different mutation.");
          return mutationResult(replay as MutationRow, true);
        }

        const [currentRow] = await tx.select().from(calendarEvents).where(and(
          eq(calendarEvents.id, input.entityId), eq(calendarEvents.householdId, context.householdId),
        )).limit(1).for("update");
        let serverState: CalendarEvent | null = null;
        let revision: bigint;

        if (input.operation === "create") {
          if (currentRow) {
            const [rejected] = await tx.update(syncMutations).set({ status: "rejected", errorCode: "CALENDAR_EVENT_ID_EXISTS" })
              .where(and(eq(syncMutations.clientId, clientId), eq(syncMutations.clientMutationId, input.clientMutationId))).returning(mutationReturning);
            if (!rejected) throw new CalendarServiceError(500, "MUTATION_RESULT_FAILED", "The Calendar rejection could not be saved.");
            return mutationResult(rejected as MutationRow, false);
          }
          let effectivePayload = input.payload;
          if (isLegacyV53EventPayload(input.payload)) {
            const [configured] = await tx
              .select({ defaultCalendarId: calendarSettings.defaultCalendarId })
              .from(calendarSettings)
              .where(eq(calendarSettings.householdId, context.householdId))
              .limit(1);
            let legacyCalendarId = configured?.defaultCalendarId ?? null;
            if (legacyCalendarId !== null) {
              const [activeDefault] = await tx
                .select({ id: calendarCalendars.id })
                .from(calendarCalendars)
                .where(and(
                  eq(calendarCalendars.id, legacyCalendarId),
                  eq(calendarCalendars.householdId, context.householdId),
                  isNull(calendarCalendars.deletedAt),
                ))
                .limit(1);
              if (!activeDefault) legacyCalendarId = null;
            }
            if (legacyCalendarId === null) {
              const [firstActive] = await tx
                .select({ id: calendarCalendars.id })
                .from(calendarCalendars)
                .where(and(
                  eq(calendarCalendars.householdId, context.householdId),
                  isNull(calendarCalendars.deletedAt),
                ))
                .orderBy(calendarCalendars.createdAt, calendarCalendars.id)
                .limit(1);
              legacyCalendarId = firstActive?.id ?? null;
            }
            if (legacyCalendarId === null) {
              throw new CalendarServiceError(
                500,
                "CALENDAR_DEFAULT_MISSING",
                "Calendar has no active household calendar for the queued legacy event.",
              );
            }
            effectivePayload = {
              ...input.payload,
              calendarId: legacyCalendarId,
              timeZone: context.timeZone,
              // 5.3 all-day was a display flag over instants. Preserve those
              // exact instants during queue upgrade instead of inventing dates.
              allDay: false,
              startDate: null,
              endDateExclusive: null,
            };
          }
          const state = normalizeEventState(effectivePayload);
          await requireActiveEventPeople(tx, context.householdId, state);
          const [layer] = await tx.select({ id: calendarCalendars.id }).from(calendarCalendars).where(and(
            eq(calendarCalendars.id, state.calendarId), eq(calendarCalendars.householdId, context.householdId), isNull(calendarCalendars.deletedAt),
          )).limit(1);
          if (!layer) throw new CalendarServiceError(400, "CALENDAR_LAYER_NOT_FOUND", "The event calendar is not active in this household.");
          const [created] = await tx.insert(calendarEvents).values({
            id: input.entityId, householdId: context.householdId, calendarId: state.calendarId,
            title: state.title, description: state.description, startsAt: state.startsAt, endsAt: state.endsAt, allDay: state.allDay,
            timeZone: state.timeZone, startDate: state.startDate, endDateExclusive: state.endDateExclusive,
            location: state.location, notes: state.notes, recurrence: state.recurrence, recurrenceOverrides: state.recurrenceOverrides,
            personIds: [...state.personIds], reminderMinutes: [...state.reminderMinutes], transport: state.transport, createdByUserId: context.userId, updatedByUserId: context.userId,
          }).returning();
          if (!created) throw new CalendarServiceError(500, "CALENDAR_CREATE_FAILED", "The Calendar event could not be created.");
          serverState = eventFromRow(created);
          revision = created.revision;
        } else {
          if (!currentRow || currentRow.deletedAt !== null) {
            const [rejected] = await tx.update(syncMutations).set({ status: "rejected", errorCode: "CALENDAR_EVENT_NOT_FOUND" })
              .where(and(eq(syncMutations.clientId, clientId), eq(syncMutations.clientMutationId, input.clientMutationId))).returning(mutationReturning);
            if (!rejected) throw new CalendarServiceError(500, "MUTATION_RESULT_FAILED", "The Calendar rejection could not be saved.");
            return mutationResult(rejected as MutationRow, false);
          }
          if (currentRow.revision !== input.baseRevision) {
            const current = eventFromRow(currentRow);
            const [conflict] = await tx.update(syncMutations).set({ status: "conflict", serverRevision: currentRow.revision, errorCode: "REVISION_CONFLICT", resultPayload: current })
              .where(and(eq(syncMutations.clientId, clientId), eq(syncMutations.clientMutationId, input.clientMutationId))).returning(mutationReturning);
            if (!conflict) throw new CalendarServiceError(500, "MUTATION_RESULT_FAILED", "The Calendar conflict could not be saved.");
            return mutationResult(conflict as MutationRow, false);
          }
          if (input.operation === "delete") {
            const [deleted] = await tx.update(calendarEvents).set({ revision: currentRow.revision + 1n, deletedAt: new Date(), updatedAt: new Date(), updatedByUserId: context.userId })
              .where(and(eq(calendarEvents.id, input.entityId), eq(calendarEvents.householdId, context.householdId), isNull(calendarEvents.deletedAt))).returning({ revision: calendarEvents.revision });
            if (!deleted) throw new CalendarServiceError(409, "CALENDAR_EVENT_CHANGED", "The Calendar event changed before deletion.");
            revision = deleted.revision;
          } else {
            const effectivePayload = isLegacyV53EventPayload(input.payload)
              ? {
                  ...input.payload,
                  calendarId: currentRow.calendarId,
                  timeZone: currentRow.timeZone,
                  // Preserve the 5.3 instant range exactly.
                  allDay: false,
                  startDate: null,
                  endDateExclusive: null,
                }
              : input.payload;
            const state = normalizeEventState(effectivePayload, currentRow);
            await requireActiveEventPeople(tx, context.householdId, state);
            const [layer] = await tx.select({ id: calendarCalendars.id }).from(calendarCalendars).where(and(
              eq(calendarCalendars.id, state.calendarId), eq(calendarCalendars.householdId, context.householdId), isNull(calendarCalendars.deletedAt),
            )).limit(1);
            if (!layer) throw new CalendarServiceError(400, "CALENDAR_LAYER_NOT_FOUND", "The event calendar is not active in this household.");
            const [updated] = await tx.update(calendarEvents).set({
              calendarId: state.calendarId, title: state.title, description: state.description, startsAt: state.startsAt, endsAt: state.endsAt,
              allDay: state.allDay, timeZone: state.timeZone, startDate: state.startDate, endDateExclusive: state.endDateExclusive,
              location: state.location, notes: state.notes, recurrence: state.recurrence, recurrenceOverrides: state.recurrenceOverrides,
              personIds: [...state.personIds], reminderMinutes: [...state.reminderMinutes], transport: state.transport, revision: currentRow.revision + 1n, updatedAt: new Date(), updatedByUserId: context.userId,
            }).where(and(eq(calendarEvents.id, input.entityId), eq(calendarEvents.householdId, context.householdId), isNull(calendarEvents.deletedAt))).returning();
            if (!updated) throw new CalendarServiceError(409, "CALENDAR_EVENT_CHANGED", "The Calendar event changed before update.");
            serverState = eventFromRow(updated);
            revision = updated.revision;
          }
        }

        const [change] = await tx.insert(changeLog).values({ householdId: context.householdId, moduleKey: "calendar", entityType: "event", entityId: input.entityId, operation: input.operation, revision, changedByUserId: context.userId, clientId }).returning({ sequence: changeLog.sequence });
        if (!change) throw new CalendarServiceError(500, "CHANGE_LOG_FAILED", "The Calendar change could not be recorded.");
        const eventType = input.operation === "create" ? "calendar.event.created" : input.operation === "update" ? "calendar.event.updated" : "calendar.event.deleted";
        await tx.insert(auditLog).values({ householdId: context.householdId, actorUserId: context.userId, actorClientId: clientId, action: eventType, targetType: "calendar.event", targetId: input.entityId, sourceModuleKey: "calendar", requestId: context.requestId, metadata: { clientMutationId: input.clientMutationId, revision: revision.toString() } });
        await tx.insert(eventOutbox).values({ householdId: context.householdId, sourceModuleKey: "calendar", eventType, aggregateType: "calendar.event", aggregateId: input.entityId, payload: serverState ?? { id: input.entityId, revision: revision.toString() } });
        const [applied] = await tx.update(syncMutations).set({ status: "applied", serverRevision: revision, changeSequence: change.sequence, appliedAt: new Date(), errorCode: null, resultPayload: serverState })
          .where(and(eq(syncMutations.clientId, clientId), eq(syncMutations.clientMutationId, input.clientMutationId))).returning(mutationReturning);
        if (!applied) throw new CalendarServiceError(500, "MUTATION_RESULT_FAILED", "The Calendar mutation result could not be saved.");
        return mutationResult(applied as MutationRow, false);
      });
    },
  };
}
