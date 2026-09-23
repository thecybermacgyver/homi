import { parseEventPayload, validEventTime } from "./event-validation.js";
import {
  isCalendarLayer,
  isCalendarLayerCreate,
  isCalendarLayerDelete,
  isCalendarLayerUpdate,
  type CalendarLayer,
  type CalendarLayerCreate,
  type CalendarLayerDelete,
  type CalendarLayerDeleteResult,
  type CalendarLayerUpdate,
  type CalendarLayerWriteResult,
} from "./calendars.js";
import type {
  CalendarEvent,
  CalendarEventPayload,
  CalendarMutationResult,
  CalendarPerson,
  CalendarSearchResult,
} from "./types.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
const NON_NEGATIVE_INTEGER = /^(0|[1-9][0-9]*)$/;

export interface CalendarBrowserMutationInput {
  readonly householdId: string;
  readonly clientId: string;
  readonly clientMutationId: string;
  readonly moduleKey: "calendar";
  readonly entityType: "event";
  readonly entityId: string;
  readonly operation: "create" | "update" | "delete";
  readonly baseRevision: string;
  readonly payload: Readonly<CalendarEventPayload>;
}

export class CalendarBrowserError extends Error {
  readonly status: number | undefined;
  readonly requestId: string | undefined;

  constructor(
    public readonly code: string,
    message: string,
    options: ErrorOptions & { status?: number; requestId?: string } = {},
  ) {
    super(message, options);
    this.name = "CalendarBrowserError";
    this.status = options.status;
    this.requestId = options.requestId;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  try {
    return new Date(time).toISOString() === value;
  } catch {
    return false;
  }
}

function invalidInput(message: string): never {
  throw new CalendarBrowserError(
    "MUTATION_SUBMISSION_INVALID_INPUT",
    message,
  );
}

function capturePayload(source: unknown, operation: CalendarBrowserMutationInput['operation']): CalendarEventPayload {
  try { return parseEventPayload(source, operation); } catch (error) { return invalidInput((error as Error).message); }
}

function captureMutation(input: CalendarBrowserMutationInput) {
  if (!isObject(input)) invalidInput("A Calendar mutation object is required.");

  const allowed = [
    "householdId",
    "clientId",
    "clientMutationId",
    "moduleKey",
    "entityType",
    "entityId",
    "operation",
    "baseRevision",
    "payload",
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    invalidInput("Unknown Calendar mutation field.");
  }

  if (
    !isUuid(input.householdId) ||
    !isUuid(input.clientId) ||
    !isUuid(input.clientMutationId) ||
    !isUuid(input.entityId)
  ) {
    invalidInput(
      "householdId, clientId, clientMutationId and entityId must be valid UUIDs.",
    );
  }

  if (input.moduleKey !== "calendar" || input.entityType !== "event") {
    invalidInput("Only calendar/event mutations are supported.");
  }

  if (
    input.operation !== "create" &&
    input.operation !== "update" &&
    input.operation !== "delete"
  ) {
    invalidInput("Calendar operation must be create, update or delete.");
  }

  if (!NON_NEGATIVE_INTEGER.test(input.baseRevision)) {
    invalidInput("baseRevision must be a non-negative integer string.");
  }
  if (input.operation === "create" && input.baseRevision !== "0") {
    invalidInput("Calendar create requires baseRevision 0.");
  }
  if (
    input.operation !== "create" &&
    !POSITIVE_INTEGER.test(input.baseRevision)
  ) {
    invalidInput("Calendar update/delete require a positive baseRevision.");
  }

  const payload = capturePayload(input.payload, input.operation);

  return {
    householdId: input.householdId,
    clientId: input.clientId,
    clientMutationId: input.clientMutationId,
    body: JSON.stringify({
      clientMutationId: input.clientMutationId,
      moduleKey: "calendar",
      entityType: "event",
      entityId: input.entityId,
      operation: input.operation,
      baseRevision: input.baseRevision,
      payload,
    }),
  };
}

export function copyEvent(
  value: unknown,
  expectedHouseholdId?: string,
): CalendarEvent | undefined {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      "id",
      "householdId",
      "title",
      "description",
      "calendarId", "timeZone", "startDate", "endDateExclusive",
      "startsAt",
      "endsAt",
      "allDay",
      "location",
      "notes",
      "recurrence",
      "recurrenceOverrides",
      "personIds",
      "reminderMinutes",
      "transport",
      "revision",
      "createdAt",
      "updatedAt",
    ]) ||
    !isUuid(value.id) ||
    !isUuid(value.householdId) ||
    (expectedHouseholdId !== undefined &&
      value.householdId.toLowerCase() !== expectedHouseholdId.toLowerCase()) ||
    typeof value.title !== "string" ||
    (value.description !== null && typeof value.description !== "string") ||
    !isUuid(value.calendarId) ||
    !validEventTime(value as CalendarEventPayload) ||
    (() => { try { parseEventPayload({
      calendarId: value.calendarId, title: value.title, description: value.description, allDay: value.allDay,
      timeZone: value.timeZone, startsAt: value.startsAt, endsAt: value.endsAt, startDate: value.startDate,
      endDateExclusive: value.endDateExclusive, location: value.location, notes: value.notes, recurrence: value.recurrence,
      recurrenceOverrides: value.recurrenceOverrides, personIds: value.personIds, reminderMinutes: value.reminderMinutes, transport: value.transport,
    }, "create"); return false; } catch { return true; } })() ||
    typeof value.allDay !== "boolean" ||
    (value.location !== null && typeof value.location !== "string") ||
    (value.notes !== null && typeof value.notes !== "string") ||
    typeof value.revision !== "string" ||
    !POSITIVE_INTEGER.test(value.revision) ||
    !isIsoDate(value.createdAt) ||
    !isIsoDate(value.updatedAt)
  ) {
    return undefined;
  }

  return Object.freeze({
    id: value.id,
    householdId: value.householdId,
    title: value.title,
    description: value.description as string | null,
    calendarId: value.calendarId,
    timeZone: value.timeZone as string,
    startDate: value.startDate as string | null,
    endDateExclusive: value.endDateExclusive as string | null,
    startsAt: value.startsAt as string | null,
    endsAt: value.endsAt as string | null,
    allDay: value.allDay,
    location: value.location,
    notes: value.notes,
    recurrence: value.recurrence as CalendarEvent["recurrence"],
    recurrenceOverrides: value.recurrenceOverrides as CalendarEvent["recurrenceOverrides"],
    personIds: value.personIds as CalendarEvent["personIds"],
    reminderMinutes: value.reminderMinutes as CalendarEvent["reminderMinutes"],
    transport: value.transport as CalendarEvent["transport"],
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}

async function readResponse(
  response: Response,
  invalidCode: string,
): Promise<unknown> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (cause) {
    throw new CalendarBrowserError(
      invalidCode,
      "The Calendar response was not valid JSON.",
      { status: response.status, cause },
    );
  }

  if (!response.ok) {
    const error = isObject(body) ? body.error : undefined;
    if (
      isObject(error) &&
      isNonEmpty(error.code) &&
      typeof error.message === "string" &&
      (error.requestId === undefined || isNonEmpty(error.requestId))
    ) {
      throw new CalendarBrowserError(error.code, error.message, {
        status: response.status,
        ...(typeof error.requestId === "string"
          ? { requestId: error.requestId }
          : {}),
      });
    }

    throw new CalendarBrowserError(
      invalidCode,
      "The Calendar error response was invalid.",
      { status: response.status },
    );
  }

  return body;
}

async function calendarFetch(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  transportCode: string,
): Promise<Response> {
  try {
    signal?.throwIfAborted();
    const response = await fetch(url, {
      ...init,
      credentials: "same-origin",
      ...(signal ? { signal } : {}),
    });
    signal?.throwIfAborted();
    return response;
  } catch (cause) {
    throw new CalendarBrowserError(
      transportCode,
      "The Calendar request could not be completed.",
      { cause },
    );
  }
}

function identityHeaders(householdId: string, clientId: string) {
  if (!isUuid(householdId) || !isUuid(clientId)) {
    throw new CalendarBrowserError(
      "CALENDAR_INVALID_INPUT",
      "householdId and clientId must be valid UUIDs.",
    );
  }

  return {
    "X-Homi-Household-ID": householdId,
    "X-Homi-Client-ID": clientId,
  };
}

function copyPerson(value: unknown): CalendarPerson | undefined {
  if (!isObject(value) || !exactKeys(value, ["id", "displayName", "avatarFileId"])
    || !isUuid(value.id)
    || typeof value.displayName !== "string"
    || value.displayName.trim().length < 1
    || (value.avatarFileId !== null && !isUuid(value.avatarFileId))) return undefined;
  return Object.freeze({
    id: value.id,
    displayName: value.displayName,
    avatarFileId: value.avatarFileId as string | null,
  });
}

export async function fetchCalendarPeople(
  input: { householdId: string; clientId: string },
  signal?: AbortSignal,
): Promise<readonly CalendarPerson[]> {
  const response = await calendarFetch(
    "/api/v1/modules/calendar/people",
    { method: "GET", headers: identityHeaders(input.householdId, input.clientId) },
    signal,
    "CALENDAR_PEOPLE_TRANSPORT_FAILED",
  );
  const body = await readResponse(response, "CALENDAR_PEOPLE_INVALID_RESPONSE");
  const data = isObject(body) && exactKeys(body, ["data"]) ? body.data : undefined;
  if (!isObject(data) || !exactKeys(data, ["people"]) || !Array.isArray(data.people)) {
    throw new CalendarBrowserError("CALENDAR_PEOPLE_INVALID_RESPONSE", "The Calendar people response was invalid.", { status: response.status });
  }
  const people: CalendarPerson[] = [];
  for (const raw of data.people) {
    const person = copyPerson(raw);
    if (!person) throw new CalendarBrowserError("CALENDAR_PEOPLE_INVALID_RESPONSE", "Calendar people contained invalid state.", { status: response.status });
    people.push(person);
  }
  signal?.throwIfAborted();
  return Object.freeze(people);
}

export async function searchCalendarEvents(
  input: { householdId: string; clientId: string; query: string; limit?: number },
  signal?: AbortSignal,
): Promise<readonly CalendarSearchResult[]> {
  const query = input.query.trim();
  const limit = input.limit ?? 50;
  if (query.length < 1 || query.length > 200 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new CalendarBrowserError("CALENDAR_INVALID_INPUT", "Calendar search requires 1 to 200 characters and a limit from 1 to 100.");
  }
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const response = await calendarFetch(
    "/api/v1/modules/calendar/search?" + params.toString(),
    { method: "GET", headers: identityHeaders(input.householdId, input.clientId) },
    signal,
    "CALENDAR_SEARCH_TRANSPORT_FAILED",
  );
  const body = await readResponse(response, "CALENDAR_SEARCH_INVALID_RESPONSE");
  const data = isObject(body) && exactKeys(body, ["data"]) ? body.data : undefined;
  if (!isObject(data) || !exactKeys(data, ["results"]) || !Array.isArray(data.results)) {
    throw new CalendarBrowserError("CALENDAR_SEARCH_INVALID_RESPONSE", "The Calendar search response was invalid.", { status: response.status });
  }
  const results: CalendarSearchResult[] = [];
  for (const raw of data.results) {
    if (!isObject(raw) || !exactKeys(raw, ["event", "matchedPeople"]) || !Array.isArray(raw.matchedPeople)) {
      throw new CalendarBrowserError("CALENDAR_SEARCH_INVALID_RESPONSE", "Calendar search contained invalid result state.", { status: response.status });
    }
    const event = copyEvent(raw.event, input.householdId);
    const matchedPeople = raw.matchedPeople.map(copyPerson);
    if (!event || matchedPeople.some((person) => person === undefined)) {
      throw new CalendarBrowserError("CALENDAR_SEARCH_INVALID_RESPONSE", "Calendar search contained invalid event or people state.", { status: response.status });
    }
    results.push(Object.freeze({ event, matchedPeople: Object.freeze(matchedPeople as CalendarPerson[]) }));
  }
  signal?.throwIfAborted();
  return Object.freeze(results);
}

export async function fetchCalendarEvent(
  input: {
    householdId: string;
    clientId: string;
    eventId: string;
  },
  signal?: AbortSignal,
): Promise<CalendarEvent> {
  if (!isUuid(input.eventId)) {
    throw new CalendarBrowserError(
      "CALENDAR_INVALID_INPUT",
      "eventId must be a valid UUID.",
    );
  }

  const response = await calendarFetch(
    "/api/v1/modules/calendar/events/" + input.eventId,
    {
      method: "GET",
      headers: identityHeaders(input.householdId, input.clientId),
    },
    signal,
    "CALENDAR_FETCH_TRANSPORT_FAILED",
  );
  const body = await readResponse(
    response,
    "CALENDAR_FETCH_INVALID_RESPONSE",
  );
  const data =
    isObject(body) && exactKeys(body, ["data"]) ? body.data : undefined;
  const event = copyEvent(data, input.householdId);
  if (!event || event.id.toLowerCase() !== input.eventId.toLowerCase()) {
    throw new CalendarBrowserError(
      "CALENDAR_FETCH_INVALID_RESPONSE",
      "The Calendar event response contained invalid identity or state.",
      { status: response.status },
    );
  }
  signal?.throwIfAborted();
  return event;
}

export async function fetchCalendarEvents(
  input: {
    householdId: string;
    clientId: string;
    from: string;
    to: string;
  },
  signal?: AbortSignal,
): Promise<readonly CalendarEvent[]> {
  if (!isIsoDate(input.from) || !isIsoDate(input.to)) {
    throw new CalendarBrowserError(
      "CALENDAR_INVALID_INPUT",
      "from and to must be ISO date-times.",
    );
  }
  if (Date.parse(input.to) <= Date.parse(input.from)) {
    throw new CalendarBrowserError(
      "CALENDAR_INVALID_INPUT",
      "Calendar range end must be after start.",
    );
  }

  const params = new URLSearchParams({
    from: input.from,
    to: input.to,
  });
  const response = await calendarFetch(
    "/api/v1/modules/calendar/events?" + params.toString(),
    {
      method: "GET",
      headers: identityHeaders(input.householdId, input.clientId),
    },
    signal,
    "CALENDAR_FETCH_TRANSPORT_FAILED",
  );
  const body = await readResponse(
    response,
    "CALENDAR_FETCH_INVALID_RESPONSE",
  );
  const data =
    isObject(body) && exactKeys(body, ["data"]) ? body.data : undefined;
  const events =
    isObject(data) &&
    exactKeys(data, ["events"]) &&
    Array.isArray(data.events)
      ? data.events
      : undefined;

  if (!events) {
    throw new CalendarBrowserError(
      "CALENDAR_FETCH_INVALID_RESPONSE",
      "The Calendar event list response was invalid.",
      { status: response.status },
    );
  }

  const copied: CalendarEvent[] = [];
  for (const raw of events) {
    const event = copyEvent(raw, input.householdId);
    if (!event) {
      throw new CalendarBrowserError(
        "CALENDAR_FETCH_INVALID_RESPONSE",
        "The Calendar event list contained invalid state.",
        { status: response.status },
      );
    }
    copied.push(event);
  }

  signal?.throwIfAborted();
  return Object.freeze(copied);
}

export async function submitCalendarMutation(
  input: CalendarBrowserMutationInput,
  signal?: AbortSignal,
): Promise<CalendarMutationResult> {
  let captured: ReturnType<typeof captureMutation>;
  try {
    captured = captureMutation(input);
  } catch (cause) {
    if (cause instanceof CalendarBrowserError) throw cause;
    throw new CalendarBrowserError(
      "MUTATION_SUBMISSION_INVALID_INPUT",
      "Invalid Calendar mutation input.",
      { cause },
    );
  }

  let dispatched = false;
  let status: number | undefined;

  function transport(cause: unknown): CalendarBrowserError {
    return new CalendarBrowserError(
      "MUTATION_SUBMISSION_TRANSPORT_FAILED",
      dispatched
        ? "Calendar mutation submission did not complete; the server outcome is unknown."
        : "Calendar mutation submission was cancelled before dispatch.",
      { cause, ...(status === undefined ? {} : { status }) },
    );
  }

  let response: Response;
  try {
    signal?.throwIfAborted();
    dispatched = true;
    response = await fetch("/api/v1/modules/calendar/mutations", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        ...identityHeaders(captured.householdId, captured.clientId),
        "Content-Type": "application/json",
      },
      body: captured.body,
      ...(signal ? { signal } : {}),
    });
    status = response.status;
    signal?.throwIfAborted();
  } catch (cause) {
    throw transport(cause);
  }

  let body: unknown;
  try {
    body = await readResponse(
      response,
      "MUTATION_SUBMISSION_INVALID_RESPONSE",
    );
    signal?.throwIfAborted();
  } catch (cause) {
    if (
      cause instanceof CalendarBrowserError &&
      cause.code !== "MUTATION_SUBMISSION_INVALID_RESPONSE"
    ) {
      throw cause;
    }
    if (signal?.aborted) throw transport(cause);
    throw cause;
  }

  const data =
    isObject(body) && exactKeys(body, ["data"]) ? body.data : undefined;
  if (
    !isObject(data) ||
    !exactKeys(data, [
      "clientMutationId",
      "status",
      "serverRevision",
      "changeSequence",
      "errorCode",
      "serverState",
      "replayed",
    ]) ||
    data.clientMutationId !== captured.clientMutationId ||
    (data.status !== "received" &&
      data.status !== "applied" &&
      data.status !== "conflict" &&
      data.status !== "rejected") ||
    (data.serverRevision !== null &&
      (typeof data.serverRevision !== "string" ||
        !POSITIVE_INTEGER.test(data.serverRevision))) ||
    (data.changeSequence !== null &&
      (typeof data.changeSequence !== "string" ||
        !NON_NEGATIVE_INTEGER.test(data.changeSequence))) ||
    (data.errorCode !== null && !isNonEmpty(data.errorCode)) ||
    typeof data.replayed !== "boolean"
  ) {
    throw new CalendarBrowserError(
      "MUTATION_SUBMISSION_INVALID_RESPONSE",
      "The Calendar mutation response contained an invalid result.",
      { status: response.status },
    );
  }

  let serverState: CalendarEvent | null;
  if (data.serverState === null) {
    serverState = null;
  } else {
    const event = copyEvent(data.serverState, input.householdId);
    if (!event || event.id.toLowerCase() !== input.entityId.toLowerCase()) {
      throw new CalendarBrowserError(
        "MUTATION_SUBMISSION_INVALID_RESPONSE",
        "The Calendar mutation response contained invalid serverState.",
        { status: response.status },
      );
    }
    serverState = event;
  }

  try {
    signal?.throwIfAborted();
  } catch (cause) {
    throw transport(cause);
  }

  return Object.freeze({
    clientMutationId: data.clientMutationId,
    status: data.status,
    serverRevision: data.serverRevision,
    changeSequence: data.changeSequence,
    errorCode: data.errorCode,
    serverState,
    replayed: data.replayed,
  });
}

export * from "./settings.js";
export * from "./calendars.js";
import {
  exactSettingsObject,
  isCalendarSettings,
  isCalendarSettingsWrite,
  type CalendarSettings,
  type CalendarSettingsWrite,
  type CalendarSettingsResult,
} from "./settings.js";

export async function fetchCalendarSettings(
  input: { householdId: string; clientId: string },
  signal?: AbortSignal,
): Promise<CalendarSettings> {
  const response = await calendarFetch(
    "/api/v1/modules/calendar/settings",
    { method: "GET", headers: identityHeaders(input.householdId, input.clientId) },
    signal,
    "CALENDAR_FETCH_TRANSPORT_FAILED",
  );
  const body = await readResponse(response, "CALENDAR_SETTINGS_INVALID_RESPONSE");
  if (
    !isObject(body) ||
    !exactKeys(body, ["data"]) ||
    !isCalendarSettings(body.data, input.householdId)
  ) {
    throw new CalendarBrowserError(
      "CALENDAR_SETTINGS_INVALID_RESPONSE",
      "Invalid Calendar settings response.",
      { status: response.status },
    );
  }
  signal?.throwIfAborted();
  return Object.freeze({ ...body.data });
}

/** Online-only compare-and-set. Unknown outcomes require a fresh read; never blind retry. */
export async function saveCalendarSettings(
  input: {
    householdId: string;
    clientId: string;
    settings: CalendarSettingsWrite;
  },
  signal?: AbortSignal,
): Promise<CalendarSettingsResult> {
  if (!isCalendarSettingsWrite(input.settings)) {
    throw new CalendarBrowserError("CALENDAR_INVALID_INPUT", "Invalid Calendar settings.");
  }
  const response = await calendarFetch(
    "/api/v1/modules/calendar/settings",
    {
      method: "PUT",
      headers: {
        ...identityHeaders(input.householdId, input.clientId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.settings),
    },
    signal,
    "CALENDAR_SETTINGS_OUTCOME_UNKNOWN",
  );
  const body = await readResponse(response, "CALENDAR_SETTINGS_INVALID_RESPONSE");
  const data = isObject(body) && exactKeys(body, ["data"]) ? body.data : undefined;
  if (
    !isObject(data) ||
    !exactSettingsObject(data, ["status", "settings"]) ||
    (data.status !== "saved" && data.status !== "conflict") ||
    !isCalendarSettings(data.settings, input.householdId)
  ) {
    throw new CalendarBrowserError(
      "CALENDAR_SETTINGS_INVALID_RESPONSE",
      "Invalid Calendar settings save response.",
      { status: response.status },
    );
  }
  if (
    data.status === "saved" &&
    (BigInt(data.settings.revision) !== BigInt(input.settings.baseRevision) + 1n ||
      data.settings.state !== input.settings.state ||
      data.settings.defaultView !== input.settings.defaultView ||
      data.settings.weekStart !== input.settings.weekStart ||
      data.settings.timeZone !== input.settings.timeZone ||
      data.settings.defaultReminder !== input.settings.defaultReminder ||
      data.settings.defaultCalendarId !== input.settings.defaultCalendarId)
  ) {
    throw new CalendarBrowserError(
      "CALENDAR_SETTINGS_INVALID_RESPONSE",
      "Settings save did not match the request.",
      { status: response.status },
    );
  }
  signal?.throwIfAborted();
  return Object.freeze({
    status: data.status,
    settings: Object.freeze({ ...data.settings }),
  });
}

function copyLayer(value: unknown, householdId: string): CalendarLayer | undefined {
  if (!isCalendarLayer(value, householdId)) return undefined;
  return Object.freeze({ ...value });
}

function layerWriteResult(
  body: unknown,
  householdId: string,
  calendarId: string,
  response: Response,
): CalendarLayerWriteResult {
  const data = isObject(body) && exactKeys(body, ["data"]) ? body.data : undefined;
  if (
    !isObject(data) ||
    !exactKeys(data, ["status", "calendar"]) ||
    (data.status !== "saved" && data.status !== "conflict")
  ) {
    throw new CalendarBrowserError(
      "CALENDAR_LAYER_INVALID_RESPONSE",
      "The Calendar layer write response was invalid.",
      { status: response.status },
    );
  }
  const calendar = copyLayer(data.calendar, householdId);
  if (!calendar || calendar.id !== calendarId) {
    throw new CalendarBrowserError(
      "CALENDAR_LAYER_INVALID_RESPONSE",
      "The Calendar layer write returned invalid authoritative state.",
      { status: response.status },
    );
  }
  return Object.freeze({ status: data.status, calendar });
}

export async function fetchCalendarLayers(
  input: { householdId: string; clientId: string },
  signal?: AbortSignal,
): Promise<readonly CalendarLayer[]> {
  const response = await calendarFetch(
    "/api/v1/modules/calendar/calendars",
    { method: "GET", headers: identityHeaders(input.householdId, input.clientId) },
    signal,
    "CALENDAR_FETCH_TRANSPORT_FAILED",
  );
  const body = await readResponse(response, "CALENDAR_LAYER_INVALID_RESPONSE");
  const data = isObject(body) && exactKeys(body, ["data"]) ? body.data : undefined;
  if (!isObject(data) || !exactKeys(data, ["calendars"]) || !Array.isArray(data.calendars)) {
    throw new CalendarBrowserError(
      "CALENDAR_LAYER_INVALID_RESPONSE",
      "The Calendar layer list response was invalid.",
      { status: response.status },
    );
  }
  const layers: CalendarLayer[] = [];
  for (const value of data.calendars) {
    const layer = copyLayer(value, input.householdId);
    if (!layer) {
      throw new CalendarBrowserError(
        "CALENDAR_LAYER_INVALID_RESPONSE",
        "The Calendar layer list contained invalid state.",
        { status: response.status },
      );
    }
    layers.push(layer);
  }
  return Object.freeze(layers);
}

export async function fetchCalendarLayer(
  input: { householdId: string; clientId: string; calendarId: string },
  signal?: AbortSignal,
): Promise<CalendarLayer> {
  if (!isUuid(input.calendarId)) {
    throw new CalendarBrowserError("CALENDAR_INVALID_INPUT", "Invalid calendar UUID.");
  }
  const response = await calendarFetch(
    "/api/v1/modules/calendar/calendars/" + input.calendarId,
    { method: "GET", headers: identityHeaders(input.householdId, input.clientId) },
    signal,
    "CALENDAR_FETCH_TRANSPORT_FAILED",
  );
  const body = await readResponse(response, "CALENDAR_LAYER_INVALID_RESPONSE");
  const data = isObject(body) && exactKeys(body, ["data"]) ? body.data : undefined;
  const layer = copyLayer(data, input.householdId);
  if (!layer || layer.id !== input.calendarId) {
    throw new CalendarBrowserError(
      "CALENDAR_LAYER_INVALID_RESPONSE",
      "The Calendar layer response was invalid.",
      { status: response.status },
    );
  }
  return layer;
}

export async function createCalendarLayer(
  input: { householdId: string; clientId: string; calendar: CalendarLayerCreate },
  signal?: AbortSignal,
): Promise<CalendarLayerWriteResult> {
  if (!isCalendarLayerCreate(input.calendar)) {
    throw new CalendarBrowserError("CALENDAR_INVALID_INPUT", "Invalid Calendar create request.");
  }
  const response = await calendarFetch(
    "/api/v1/modules/calendar/calendars",
    {
      method: "POST",
      headers: { ...identityHeaders(input.householdId, input.clientId), "Content-Type": "application/json" },
      body: JSON.stringify(input.calendar),
    },
    signal,
    "CALENDAR_LAYER_OUTCOME_UNKNOWN",
  );
  const body = await readResponse(response, "CALENDAR_LAYER_INVALID_RESPONSE");
  return layerWriteResult(body, input.householdId, input.calendar.id, response);
}

export async function updateCalendarLayer(
  input: {
    householdId: string;
    clientId: string;
    calendarId: string;
    update: CalendarLayerUpdate;
  },
  signal?: AbortSignal,
): Promise<CalendarLayerWriteResult> {
  if (!isUuid(input.calendarId) || !isCalendarLayerUpdate(input.update)) {
    throw new CalendarBrowserError("CALENDAR_INVALID_INPUT", "Invalid Calendar update request.");
  }
  const response = await calendarFetch(
    "/api/v1/modules/calendar/calendars/" + input.calendarId,
    {
      method: "PUT",
      headers: { ...identityHeaders(input.householdId, input.clientId), "Content-Type": "application/json" },
      body: JSON.stringify(input.update),
    },
    signal,
    "CALENDAR_LAYER_OUTCOME_UNKNOWN",
  );
  const body = await readResponse(response, "CALENDAR_LAYER_INVALID_RESPONSE");
  return layerWriteResult(body, input.householdId, input.calendarId, response);
}

export async function deleteCalendarLayer(
  input: {
    householdId: string;
    clientId: string;
    calendarId: string;
    delete: CalendarLayerDelete;
  },
  signal?: AbortSignal,
): Promise<CalendarLayerDeleteResult> {
  if (!isUuid(input.calendarId) || !isCalendarLayerDelete(input.delete)) {
    throw new CalendarBrowserError("CALENDAR_INVALID_INPUT", "Invalid Calendar delete request.");
  }
  const response = await calendarFetch(
    "/api/v1/modules/calendar/calendars/" + input.calendarId,
    {
      method: "DELETE",
      headers: { ...identityHeaders(input.householdId, input.clientId), "Content-Type": "application/json" },
      body: JSON.stringify(input.delete),
    },
    signal,
    "CALENDAR_LAYER_OUTCOME_UNKNOWN",
  );
  const body = await readResponse(response, "CALENDAR_LAYER_INVALID_RESPONSE");
  const data = isObject(body) && exactKeys(body, ["data"]) ? body.data : undefined;
  if (
    !isObject(data) ||
    !exactKeys(data, ["status", "calendar"]) ||
    (data.status !== "deleted" && data.status !== "conflict")
  ) {
    throw new CalendarBrowserError(
      "CALENDAR_LAYER_INVALID_RESPONSE",
      "The Calendar delete response was invalid.",
      { status: response.status },
    );
  }
  const calendar = copyLayer(data.calendar, input.householdId);
  if (!calendar || calendar.id !== input.calendarId) {
    throw new CalendarBrowserError(
      "CALENDAR_LAYER_INVALID_RESPONSE",
      "The Calendar delete returned invalid authoritative state.",
      { status: response.status },
    );
  }
  return Object.freeze({ status: data.status, calendar });
}

export {
  validRecurrenceOverrides,
  validRecurrenceRule,
  validReminderMinutes,
  validTransportContext,
} from "./event-validation.js";
export {
  expandCalendarEvent,
  expandCalendarEvents,
  recurrenceOccursOn,
} from "./recurrence.js";
