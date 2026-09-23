import type {
  CalendarEvent,
  CalendarEventPayload,
  CalendarLayer,
  CalendarPerson,
} from "@homi/calendar";
import {
  createCalendarLayer,
  deleteCalendarLayer,
  fetchCalendarLayer,
  fetchCalendarLayers,
  fetchCalendarPeople,
  fetchCalendarSettings,
  isCalendarLayer,
  isCalendarSettings,
  saveCalendarSettings,
  updateCalendarLayer,
  validRecurrenceOverrides,
  validRecurrenceRule,
  validReminderMinutes,
  validTransportContext,
  type CalendarSettings,
  type CalendarSettingsResult,
  type CalendarSettingsWrite,
  type CalendarLayerCreate,
  type CalendarLayerDelete,
  type CalendarLayerDeleteResult,
  type CalendarLayerUpdate,
  type CalendarLayerWriteResult,
} from "@homi/calendar/client";
import {
  completeMutation,
  deleteCachedRecord,
  enqueueMutation,
  getCachedRecord,
  getCachedRecords,
  getHouseholdMutations,
  putCachedRecord,
  rewriteUnsentMutation,
  type QueuedMutation,
} from "../../sync/local-db.js";


async function cacheCalendarSettings(
  authSubject: string,
  householdId: string,
  settings: CalendarSettings,
): Promise<void> {
  const existing = await getCachedRecord(authSubject, householdId, {
    moduleKey: "calendar",
    entityType: "settings",
    entityId: householdId,
  });
  await putCachedRecord(authSubject, {
    householdId,
    moduleKey: "calendar",
    entityType: "settings",
    entityId: householdId,
    revision: settings.revision,
    sequence: existing?.sequence ?? "0",
    data: settings,
  });
}

export async function loadCalendarSettings(
  authSubject: string,
  householdId: string,
): Promise<CalendarSettings | null> {
  const record = await getCachedRecord(authSubject, householdId, {
    moduleKey: "calendar",
    entityType: "settings",
    entityId: householdId,
  });
  return record && isCalendarSettings(record.data, householdId)
    ? Object.freeze({ ...record.data })
    : null;
}

export async function refreshCalendarSettings(
  authSubject: string,
  householdId: string,
  clientId: string,
  signal?: AbortSignal,
): Promise<CalendarSettings> {
  const settings = await fetchCalendarSettings(
    { householdId, clientId },
    signal,
  );
  await cacheCalendarSettings(authSubject, householdId, settings);
  return settings;
}

export async function saveCalendarSettingsOnline(
  authSubject: string,
  householdId: string,
  clientId: string,
  settings: CalendarSettingsWrite,
  signal?: AbortSignal,
): Promise<CalendarSettingsResult> {
  const result = await saveCalendarSettings(
    { householdId, clientId, settings },
    signal,
  );
  await cacheCalendarSettings(authSubject, householdId, result.settings);
  return result;
}


async function cacheCalendarLayer(
  authSubject: string,
  householdId: string,
  layer: CalendarLayer,
): Promise<void> {
  const existing = await getCachedRecord(authSubject, householdId, {
    moduleKey: "calendar",
    entityType: "calendar",
    entityId: layer.id,
  });
  await putCachedRecord(authSubject, {
    householdId,
    moduleKey: "calendar",
    entityType: "calendar",
    entityId: layer.id,
    revision: layer.revision,
    sequence: existing?.sequence ?? "0",
    data: layer,
  });
}

export async function loadCalendarLayers(
  authSubject: string,
  householdId: string,
): Promise<readonly CalendarLayer[]> {
  const records = await getCachedRecords(
    authSubject,
    householdId,
    "calendar",
    "calendar",
  );
  const layers = records
    .map((record) => record.data)
    .filter((value): value is CalendarLayer => isCalendarLayer(value, householdId))
    .map((value) => Object.freeze({ ...value }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  return Object.freeze(layers);
}

export async function refreshCalendarLayers(
  authSubject: string,
  householdId: string,
  clientId: string,
  signal?: AbortSignal,
): Promise<readonly CalendarLayer[]> {
  const layers = await fetchCalendarLayers({ householdId, clientId }, signal);
  const cached = await getCachedRecords(authSubject, householdId, "calendar", "calendar");
  const activeIds = new Set(layers.map((layer) => layer.id));
  await Promise.all([
    ...layers.map((layer) => cacheCalendarLayer(authSubject, householdId, layer)),
    ...cached
      .filter((record) => !activeIds.has(record.entityId))
      .map((record) => deleteCachedRecord(authSubject, householdId, {
        moduleKey: "calendar",
        entityType: "calendar",
        entityId: record.entityId,
      })),
  ]);
  return layers;
}

export async function refreshCalendarLayer(
  authSubject: string,
  householdId: string,
  clientId: string,
  calendarId: string,
  signal?: AbortSignal,
): Promise<CalendarLayer> {
  const layer = await fetchCalendarLayer({ householdId, clientId, calendarId }, signal);
  await cacheCalendarLayer(authSubject, householdId, layer);
  return layer;
}

export async function createCalendarLayerOnline(
  authSubject: string,
  householdId: string,
  clientId: string,
  calendar: CalendarLayerCreate,
  signal?: AbortSignal,
): Promise<CalendarLayerWriteResult> {
  const result = await createCalendarLayer({ householdId, clientId, calendar }, signal);
  await cacheCalendarLayer(authSubject, householdId, result.calendar);
  return result;
}

export async function updateCalendarLayerOnline(
  authSubject: string,
  householdId: string,
  clientId: string,
  calendarId: string,
  update: CalendarLayerUpdate,
  signal?: AbortSignal,
): Promise<CalendarLayerWriteResult> {
  const result = await updateCalendarLayer(
    { householdId, clientId, calendarId, update },
    signal,
  );
  await cacheCalendarLayer(authSubject, householdId, result.calendar);
  return result;
}

export async function deleteCalendarLayerOnline(
  authSubject: string,
  householdId: string,
  clientId: string,
  calendarId: string,
  input: CalendarLayerDelete,
  signal?: AbortSignal,
): Promise<CalendarLayerDeleteResult> {
  const result = await deleteCalendarLayer(
    { householdId, clientId, calendarId, delete: input },
    signal,
  );
  if (result.status === "deleted") {
    await deleteCachedRecord(authSubject, householdId, {
      moduleKey: "calendar",
      entityType: "calendar",
      entityId: calendarId,
    });
  } else {
    await cacheCalendarLayer(authSubject, householdId, result.calendar);
  }
  return result;
}

export interface CalendarDisplayEvent {
  readonly event: CalendarEvent;
  readonly pending: boolean;
  readonly editable: boolean;
  readonly pendingMutationId: string | null;
  readonly occurrenceId?: string;
  readonly occurrenceDate?: string;
  readonly seriesEvent?: CalendarEvent;
  readonly recurring?: boolean;
  readonly overridden?: boolean;
}

export interface CalendarLocalView {
  readonly events: readonly CalendarDisplayEvent[];
  readonly issues: readonly QueuedMutation[];
  readonly pendingCount: number;
}

export class CalendarLocalError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "CalendarLocalError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCalendarPerson(value: unknown): value is CalendarPerson {
  return isObject(value)
    && typeof value.id === "string"
    && typeof value.displayName === "string"
    && value.displayName.trim().length > 0
    && (value.avatarFileId === null || typeof value.avatarFileId === "string");
}

export async function loadCalendarPeople(
  authSubject: string,
  householdId: string,
): Promise<readonly CalendarPerson[]> {
  const records = await getCachedRecords(authSubject, householdId, "calendar", "person");
  return Object.freeze(records
    .map((record) => record.data)
    .filter(isCalendarPerson)
    .map((person) => Object.freeze({ ...person }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id)));
}

export async function refreshCalendarPeople(
  authSubject: string,
  householdId: string,
  clientId: string,
): Promise<readonly CalendarPerson[]> {
  const [people, existing] = await Promise.all([
    fetchCalendarPeople({ householdId, clientId }),
    getCachedRecords(authSubject, householdId, "calendar", "person"),
  ]);
  const authoritativeIds = new Set(people.map((person) => person.id));
  await Promise.all([
    ...people.map((person) => putCachedRecord(authSubject, {
      householdId,
      moduleKey: "calendar",
      entityType: "person",
      entityId: person.id,
      revision: "0",
      sequence: "0",
      data: person,
    })),
    ...existing
      .filter((record) => !authoritativeIds.has(record.entityId))
      .map((record) => deleteCachedRecord(authSubject, householdId, {
        moduleKey: "calendar", entityType: "person", entityId: record.entityId,
      })),
  ]);
  return people;
}

function normalizeStoredCalendarEvent(value: unknown): CalendarEvent | null {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.householdId !== "string" ||
    typeof value.calendarId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.allDay !== "boolean" ||
    typeof value.timeZone !== "string" ||
    (value.location !== null && typeof value.location !== "string") ||
    (value.notes !== null && typeof value.notes !== "string") ||
    typeof value.revision !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) return null;
  const validTime = value.allDay
    ? value.startsAt === null && value.endsAt === null
      && typeof value.startDate === "string"
      && typeof value.endDateExclusive === "string"
      && value.endDateExclusive > value.startDate
    : typeof value.startsAt === "string" && typeof value.endsAt === "string"
      && value.startDate === null && value.endDateExclusive === null
      && Date.parse(value.endsAt) > Date.parse(value.startsAt);
  if (!validTime) return null;

  const description = value.description === undefined ? null : value.description;
  const recurrence = value.recurrence === undefined ? null : value.recurrence;
  const recurrenceOverrides = value.recurrenceOverrides === undefined ? [] : value.recurrenceOverrides;
  const personIds = value.personIds === undefined ? [] : value.personIds;
  const reminderMinutes = value.reminderMinutes === undefined ? [] : value.reminderMinutes;
  const transport = value.transport === undefined
    ? { mode: "none", pickupPersonId: null, dropoffPersonId: null, notes: null }
    : value.transport;
  if ((description !== null && typeof description !== "string")
    || (recurrence !== null && !validRecurrenceRule(recurrence))
    || !validRecurrenceOverrides(recurrenceOverrides)
    || !Array.isArray(personIds)
    || personIds.some((id) => typeof id !== "string")
    || !validReminderMinutes(reminderMinutes)
    || !validTransportContext(transport)) return null;

  return Object.freeze({
    id: value.id,
    householdId: value.householdId,
    calendarId: value.calendarId,
    title: value.title,
    description,
    allDay: value.allDay,
    timeZone: value.timeZone,
    startsAt: value.startsAt as string | null,
    endsAt: value.endsAt as string | null,
    startDate: value.startDate as string | null,
    endDateExclusive: value.endDateExclusive as string | null,
    location: value.location,
    notes: value.notes,
    recurrence,
    recurrenceOverrides: Object.freeze([...recurrenceOverrides]),
    personIds: Object.freeze([...personIds]),
    reminderMinutes: Object.freeze([...reminderMinutes]),
    transport: Object.freeze({ ...transport }),
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}

function isCalendarEvent(value: unknown): value is CalendarEvent {
  return normalizeStoredCalendarEvent(value) !== null;
}

function stringOrNull(
  value: unknown,
  fallback: string | null,
): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : fallback;
}

function optimisticEvent(
  householdId: string,
  entityId: string,
  payload: Record<string, unknown>,
  timestamp: string,
): CalendarEvent | null {
  if (
    typeof payload.title !== "string" ||
    typeof payload.calendarId !== "string" ||
    typeof payload.allDay !== "boolean" ||
    typeof payload.timeZone !== "string"
  ) return null;

  const candidate: CalendarEvent = {
    id: entityId,
    householdId,
    calendarId: payload.calendarId,
    title: payload.title,
    description: stringOrNull(payload.description, null),
    allDay: payload.allDay,
    timeZone: payload.timeZone,
    startsAt: payload.allDay ? null : typeof payload.startsAt === "string" ? payload.startsAt : null,
    endsAt: payload.allDay ? null : typeof payload.endsAt === "string" ? payload.endsAt : null,
    startDate: payload.allDay && typeof payload.startDate === "string" ? payload.startDate : null,
    endDateExclusive: payload.allDay && typeof payload.endDateExclusive === "string" ? payload.endDateExclusive : null,
    location: stringOrNull(payload.location, null),
    notes: stringOrNull(payload.notes, null),
    recurrence: payload.recurrence !== undefined && (payload.recurrence === null || validRecurrenceRule(payload.recurrence)) ? payload.recurrence : null,
    recurrenceOverrides: validRecurrenceOverrides(payload.recurrenceOverrides) ? payload.recurrenceOverrides : [],
    personIds: Array.isArray(payload.personIds) && payload.personIds.every((id) => typeof id === "string") ? payload.personIds : [],
    reminderMinutes: validReminderMinutes(payload.reminderMinutes) ? payload.reminderMinutes : [],
    transport: validTransportContext(payload.transport) ? payload.transport : { mode: "none", pickupPersonId: null, dropoffPersonId: null, notes: null },
    revision: "0",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return normalizeStoredCalendarEvent(candidate);
}

function applyUpdate(
  event: CalendarEvent,
  payload: Record<string, unknown>,
  timestamp: string,
): CalendarEvent {
  const allDay = typeof payload.allDay === "boolean" ? payload.allDay : event.allDay;
  const candidate: CalendarEvent = {
    ...event,
    calendarId: typeof payload.calendarId === "string" ? payload.calendarId : event.calendarId,
    title: typeof payload.title === "string" ? payload.title : event.title,
    description: Object.hasOwn(payload, "description") ? stringOrNull(payload.description, event.description) : event.description,
    allDay,
    timeZone: typeof payload.timeZone === "string" ? payload.timeZone : event.timeZone,
    startsAt: allDay
      ? null
      : typeof payload.startsAt === "string"
        ? payload.startsAt
        : event.allDay ? null : event.startsAt,
    endsAt: allDay
      ? null
      : typeof payload.endsAt === "string"
        ? payload.endsAt
        : event.allDay ? null : event.endsAt,
    startDate: allDay
      ? typeof payload.startDate === "string"
        ? payload.startDate
        : event.allDay ? event.startDate : null
      : null,
    endDateExclusive: allDay
      ? typeof payload.endDateExclusive === "string"
        ? payload.endDateExclusive
        : event.allDay ? event.endDateExclusive : null
      : null,
    location: Object.hasOwn(payload, "location")
      ? stringOrNull(payload.location, event.location)
      : event.location,
    notes: Object.hasOwn(payload, "notes")
      ? stringOrNull(payload.notes, event.notes)
      : event.notes,
    recurrence: Object.hasOwn(payload, "recurrence")
      ? payload.recurrence === null || validRecurrenceRule(payload.recurrence) ? payload.recurrence : event.recurrence
      : event.recurrence,
    recurrenceOverrides: Object.hasOwn(payload, "recurrenceOverrides") && validRecurrenceOverrides(payload.recurrenceOverrides)
      ? payload.recurrenceOverrides : event.recurrenceOverrides,
    personIds: Object.hasOwn(payload, "personIds") && Array.isArray(payload.personIds) && payload.personIds.every((id) => typeof id === "string")
      ? payload.personIds : event.personIds,
    reminderMinutes: Object.hasOwn(payload, "reminderMinutes") && validReminderMinutes(payload.reminderMinutes)
      ? payload.reminderMinutes : event.reminderMinutes,
    transport: Object.hasOwn(payload, "transport") && validTransportContext(payload.transport)
      ? payload.transport : event.transport,
    updatedAt: timestamp,
  };
  return normalizeStoredCalendarEvent(candidate) ?? event;
}

function eventSortStart(event: CalendarEvent): string {
  return event.allDay ? `${event.startDate ?? ""}T00:00:00.000Z` : event.startsAt ?? "";
}

function eventSortEnd(event: CalendarEvent): string {
  return event.allDay ? `${event.endDateExclusive ?? ""}T00:00:00.000Z` : event.endsAt ?? "";
}

function activeCalendarMutations(
  mutations: readonly QueuedMutation[],
  entityId: string,
): QueuedMutation[] {
  return mutations.filter(
    (mutation) =>
      mutation.moduleKey === "calendar" &&
      mutation.entityType === "event" &&
      mutation.entityId === entityId &&
      mutation.status !== "conflict" &&
      mutation.status !== "rejected",
  );
}

export async function loadCalendarLocalView(
  authSubject: string,
  householdId: string,
): Promise<CalendarLocalView> {
  const [cached, mutations] = await Promise.all([
    getCachedRecords(authSubject, householdId, "calendar", "event"),
    getHouseholdMutations(authSubject, householdId),
  ]);

  const eventMap = new Map<string, CalendarEvent>();
  const pendingMap = new Map<string, QueuedMutation>();

  for (const record of cached) {
    const event = normalizeStoredCalendarEvent(record.data);
    if (event) eventMap.set(record.entityId, event);
  }

  const calendarMutations = mutations.filter(
    (mutation) =>
      mutation.moduleKey === "calendar" &&
      mutation.entityType === "event",
  );

  for (const mutation of calendarMutations) {
    if (mutation.status === "conflict" || mutation.status === "rejected") {
      continue;
    }

    if (mutation.status === "applied") {
      if (mutation.operation === "delete" || mutation.serverState === null) {
        eventMap.delete(mutation.entityId);
      } else {
        const serverEvent = normalizeStoredCalendarEvent(mutation.serverState);
        if (serverEvent) eventMap.set(mutation.entityId, serverEvent);
      }
      pendingMap.set(mutation.entityId, mutation);
      continue;
    }

    pendingMap.set(mutation.entityId, mutation);

    if (mutation.operation === "delete") {
      eventMap.delete(mutation.entityId);
      continue;
    }

    if (mutation.operation === "create") {
      const created = optimisticEvent(
        householdId,
        mutation.entityId,
        mutation.payload,
        mutation.createdAt,
      );
      if (created) eventMap.set(mutation.entityId, created);
      continue;
    }

    if (mutation.operation === "update") {
      const existing = eventMap.get(mutation.entityId);
      if (existing) {
        eventMap.set(
          mutation.entityId,
          applyUpdate(existing, mutation.payload, mutation.updatedAt),
        );
      }
    }
  }

  const events = [...eventMap.values()]
    .sort(
      (left, right) =>
        eventSortStart(left).localeCompare(eventSortStart(right)) ||
        eventSortEnd(left).localeCompare(eventSortEnd(right)) ||
        left.id.localeCompare(right.id),
    )
    .map((event) => {
      const pending = pendingMap.get(event.id) ?? null;
      return Object.freeze({
        event: Object.freeze({ ...event }),
        pending: pending !== null,
        editable:
          pending === null ||
          (pending.status === "queued" && pending.attempts === 0),
        pendingMutationId: pending?.clientMutationId ?? null,
      });
    });

  const issues = calendarMutations.filter(
    (mutation) =>
      mutation.status === "conflict" || mutation.status === "rejected",
  );

  return Object.freeze({
    events: Object.freeze(events),
    issues: Object.freeze(issues),
    pendingCount: calendarMutations.filter(
      (mutation) =>
        mutation.status === "queued" ||
        mutation.status === "sending" ||
        mutation.status === "applied",
    ).length,
  });
}

export async function queueCalendarCreate(
  authSubject: string,
  householdId: string,
  payload: CalendarEventPayload,
): Promise<QueuedMutation> {
  return enqueueMutation(authSubject, {
    householdId,
    moduleKey: "calendar",
    entityType: "event",
    entityId: crypto.randomUUID(),
    operation: "create",
    baseRevision: "0",
    payload: { ...payload },
  });
}

async function latestPendingForEntity(
  authSubject: string,
  householdId: string,
  entityId: string,
): Promise<QueuedMutation | null> {
  const mutations = await getHouseholdMutations(authSubject, householdId);
  const active = activeCalendarMutations(mutations, entityId);
  return active.length > 0 ? active[active.length - 1] ?? null : null;
}

function requireEditablePending(
  pending: QueuedMutation,
): void {
  if (pending.status !== "queued" || pending.attempts !== 0) {
    throw new CalendarLocalError(
      "CALENDAR_PENDING_UNCERTAIN",
      "This event already has a change that may have reached the server. Synchronize before editing it again.",
    );
  }
}

export async function queueCalendarUpdate(
  authSubject: string,
  householdId: string,
  event: CalendarEvent,
  payload: CalendarEventPayload,
): Promise<QueuedMutation> {
  const pending = await latestPendingForEntity(
    authSubject,
    householdId,
    event.id,
  );

  if (pending) {
    requireEditablePending(pending);

    if (pending.operation === "delete") {
      throw new CalendarLocalError(
        "CALENDAR_PENDING_DELETE",
        "This event is already queued for deletion.",
      );
    }

    if (pending.operation === "create") {
      return rewriteUnsentMutation(
        authSubject,
        pending.clientMutationId,
        {
          operation: "create",
          baseRevision: "0",
          payload: {
            ...pending.payload,
            ...payload,
          },
        },
      );
    }

    return rewriteUnsentMutation(
      authSubject,
      pending.clientMutationId,
      {
        operation: "update",
        baseRevision: pending.baseRevision,
        payload: {
          ...pending.payload,
          ...payload,
        },
      },
    );
  }

  if (event.revision === "0") {
    throw new CalendarLocalError(
      "CALENDAR_PENDING_CREATE_MISSING",
      "The local event is waiting to be created and cannot be updated separately.",
    );
  }

  return enqueueMutation(authSubject, {
    householdId,
    moduleKey: "calendar",
    entityType: "event",
    entityId: event.id,
    operation: "update",
    baseRevision: event.revision,
    payload: { ...payload },
  });
}

export async function queueCalendarDelete(
  authSubject: string,
  householdId: string,
  event: CalendarEvent,
): Promise<QueuedMutation | null> {
  const pending = await latestPendingForEntity(
    authSubject,
    householdId,
    event.id,
  );

  if (pending) {
    requireEditablePending(pending);

    if (pending.operation === "create") {
      await completeMutation(authSubject, pending.clientMutationId);
      return null;
    }

    if (pending.operation === "delete") {
      return pending;
    }

    return rewriteUnsentMutation(
      authSubject,
      pending.clientMutationId,
      {
        operation: "delete",
        baseRevision: pending.baseRevision,
        payload: {},
      },
    );
  }

  if (event.revision === "0") {
    throw new CalendarLocalError(
      "CALENDAR_PENDING_CREATE_MISSING",
      "The local event is waiting to be created and cannot be deleted separately.",
    );
  }

  return enqueueMutation(authSubject, {
    householdId,
    moduleKey: "calendar",
    entityType: "event",
    entityId: event.id,
    operation: "delete",
    baseRevision: event.revision,
    payload: {},
  });
}

export async function dismissCalendarIssue(
  authSubject: string,
  clientMutationId: string,
): Promise<void> {
  await completeMutation(authSubject, clientMutationId);
}
