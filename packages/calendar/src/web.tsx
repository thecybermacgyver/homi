import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  HOMI_MODULE_API_VERSION,
  defineHomiWebModule,
  type HomiWebModuleHostContext,
  type HomiWebModuleSurfaceProps,
} from "@homi/module-sdk";
import {
  Badge,
  Button,
  FormField,
  ModuleHeader,
  Notice,
  Select,
  SetupLayout,
  Surface,
  Tabs,
  TextField,
} from "@homi/ui";
import { CALENDAR_MODULE_KEY } from "./constants.js";
import {
  CALENDAR_COLORS,
  type CalendarColor,
} from "./settings.js";
import {
  expandCalendarEvents,
} from "./recurrence.js";
import {
  calendarEventChangeHandler,
  calendarEventMutationAdapter,
  calendarLayerChangeHandler,
  calendarLayerMutationAdapter,
  calendarSettingsChangeHandler,
  calendarSettingsMutationAdapter,
  legacyCalendarLayerChangeHandler,
  legacyCalendarLayerMutationAdapter,
  legacyCalendarSettingsChangeHandler,
  legacyCalendarSettingsMutationAdapter,
  parseCalendarEvent,
} from "./sync.js";
import type {
  CalendarEvent,
  CalendarOccurrence,
  CalendarPerson,
  CalendarRecurrenceFrequency,
  CalendarTransportMode,
} from "./types.js";

interface CalendarSettingsSnapshot {
  readonly state: string;
  readonly defaultView: string;
  readonly weekStart: string;
  readonly timeZone: string;
  readonly defaultReminder: string;
  readonly defaultCalendarId: string;
  readonly revision: string;
}

interface CalendarLayerSnapshot {
  readonly id: string;
  readonly householdId: string;
  readonly name: string;
  readonly color: CalendarColor;
  readonly kind: string;
  readonly revision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface CalendarExternalProviderStatus {
  readonly provider: "google" | "apple" | "outlook";
  readonly configured: boolean;
  readonly mode: "oauth" | "caldav";
}

interface CalendarExternalConnectionSnapshot {
  readonly id: string;
  readonly calendarId: string;
  readonly provider: "google" | "apple" | "outlook";
  readonly accountLabel: string;
  readonly remoteCalendarId: string;
  readonly status: string;
  readonly lastSyncedAt: string | null;
  readonly lastError: string | null;
}

interface CalendarIcsFeedSnapshot {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  readonly active: boolean;
}

interface CalendarChequebookOptions {
  readonly configured: boolean;
  readonly defaultAccountId: string | null;
  readonly accounts: readonly { readonly id: string; readonly name: string }[];
  readonly categories: readonly {
    readonly id: string;
    readonly name: string;
    readonly kind: "expense" | "income" | "both";
  }[];
}

interface CalendarAppleDiscovery {
  readonly href: string;
  readonly displayName: string;
}

type CalendarView = "day" | "week" | "month" | "upcoming";

function isCalendarView(value: unknown): value is CalendarView {
  return value === "day" || value === "week" || value === "month" || value === "upcoming";
}

function calendarViewStorageKey(context: HomiWebModuleHostContext): string {
  return `homi:calendar:view:${context.authSubject}:${context.householdId}`;
}

function rememberedCalendarView(
  context: HomiWebModuleHostContext,
): CalendarView | null {
  try {
    const stored = window.localStorage.getItem(calendarViewStorageKey(context));
    return isCalendarView(stored) ? stored : null;
  } catch {
    return null;
  }
}

function rememberCalendarView(
  context: HomiWebModuleHostContext,
  view: CalendarView,
): void {
  try {
    window.localStorage.setItem(calendarViewStorageKey(context), view);
  } catch {
    // Local persistence is optional; Calendar remains usable without it.
  }
}

interface CalendarEditorState {
  kind: "create" | "edit";
  seriesEvent: CalendarEvent | null;
  occurrence: CalendarOccurrence | null;
  editScope: "series" | "occurrence";
  calendarId: string;
  color: CalendarColor;
  title: string;
  description: string;
  allDay: boolean;
  timeZone: string;
  startsAt: string;
  endsAt: string;
  startDate: string;
  endDateExclusive: string;
  location: string;
  notes: string;
  recurrenceFrequency: "none" | CalendarRecurrenceFrequency;
  recurrenceInterval: string;
  recurrenceEndDate: string;
  recurrenceWeekdays: readonly number[];
  personIds: readonly string[];
  reminderMinutes: readonly number[];
  transportMode: CalendarTransportMode;
  pickupPersonId: string;
  dropoffPersonId: string;
  transportNotes: string;
}

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
  gap: "var(--homi-space-1)",
};

const dayStyle: CSSProperties = {
  minHeight: 82,
  display: "grid",
  alignContent: "start",
  gap: 6,
  padding: "10px 8px",
  border: "1px solid var(--homi-border)",
  borderRadius: "var(--homi-radius-md)",
  color: "var(--homi-text)",
  background: "var(--homi-surface-strong)",
};

const stackStyle: CSSProperties = {
  display: "grid",
  gap: "var(--homi-space-4)",
};

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function headers(
  context: HomiWebModuleHostContext,
): Record<string, string> {
  return {
    "X-Homi-Household-ID": context.householdId,
    "X-Homi-Client-ID": context.clientId,
  };
}

async function json(response: Response): Promise<unknown> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("Calendar returned an invalid response.");
  }
  if (!response.ok) {
    if (
      isObject(body) &&
      isObject(body.error) &&
      typeof body.error.message === "string"
    ) {
      throw new Error(body.error.message);
    }
    throw new Error("Calendar request failed.");
  }
  return body;
}

async function loadChequebookOptions(
  context: HomiWebModuleHostContext,
): Promise<CalendarChequebookOptions> {
  const response = await fetch(
    "/api/v1/modules/calendar/chequebook/options",
    { credentials: "same-origin", headers: headers(context) },
  );
  const body = await json(response);
  if (!isObject(body) || !isObject(body.data)) {
    throw new Error("Chequebook options response is invalid.");
  }
  return body.data as unknown as CalendarChequebookOptions;
}

async function saveChequebookRecurringLink(
  context: HomiWebModuleHostContext,
  eventId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(
    `/api/v1/modules/calendar/events/${encodeURIComponent(eventId)}/chequebook`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        ...headers(context),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  await json(response);
}

async function loadExternalProviders(
  context: HomiWebModuleHostContext,
): Promise<readonly CalendarExternalProviderStatus[]> {
  const response = await fetch(
    "/api/v1/modules/calendar/external/providers",
    { credentials: "same-origin", headers: headers(context) },
  );
  const body = await json(response);
  if (!isObject(body) || !Array.isArray(body.data)) {
    throw new Error("External Calendar provider response is invalid.");
  }
  return Object.freeze(
    body.data.filter(isObject).map((item) => ({
      provider: item.provider as CalendarExternalProviderStatus["provider"],
      configured: item.configured === true,
      mode: item.mode as CalendarExternalProviderStatus["mode"],
    })),
  );
}

async function loadExternalConnections(
  context: HomiWebModuleHostContext,
): Promise<readonly CalendarExternalConnectionSnapshot[]> {
  const response = await fetch(
    "/api/v1/modules/calendar/external/connections",
    { credentials: "same-origin", headers: headers(context) },
  );
  const body = await json(response);
  if (!isObject(body) || !Array.isArray(body.data)) {
    throw new Error("External Calendar connection response is invalid.");
  }
  return Object.freeze(
    body.data.filter(isObject).map((item) => ({
      id: String(item.id),
      calendarId: String(item.calendarId),
      provider: item.provider as CalendarExternalConnectionSnapshot["provider"],
      accountLabel: String(item.accountLabel),
      remoteCalendarId: String(item.remoteCalendarId),
      status: String(item.status),
      lastSyncedAt: typeof item.lastSyncedAt === "string" ? item.lastSyncedAt : null,
      lastError: typeof item.lastError === "string" ? item.lastError : null,
    })),
  );
}

async function beginProviderOAuth(
  context: HomiWebModuleHostContext,
  provider: "google" | "outlook",
): Promise<string> {
  const response = await fetch(
    `/api/v1/modules/calendar/external/${provider}/oauth/start`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: headers(context),
    },
  );
  const body = await json(response);
  if (
    !isObject(body) ||
    !isObject(body.data) ||
    typeof body.data.authorizationUrl !== "string"
  ) {
    throw new Error("Calendar OAuth response is invalid.");
  }
  return body.data.authorizationUrl;
}

async function discoverAppleCalendar(
  context: HomiWebModuleHostContext,
  username: string,
  password: string,
): Promise<readonly CalendarAppleDiscovery[]> {
  const response = await fetch(
    "/api/v1/modules/calendar/external/apple/discover",
    {
      method: "POST",
      credentials: "same-origin",
      headers: { ...headers(context), "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    },
  );
  const body = await json(response);
  if (!isObject(body) || !Array.isArray(body.data)) {
    throw new Error("Apple Calendar discovery response is invalid.");
  }
  return Object.freeze(
    body.data.filter(isObject).map((item) => ({
      href: String(item.href),
      displayName: String(item.displayName),
    })),
  );
}

async function connectAppleCalendar(
  context: HomiWebModuleHostContext,
  input: {
    username: string;
    password: string;
    calendarUrl: string;
    label: string;
  },
): Promise<void> {
  const response = await fetch(
    "/api/v1/modules/calendar/external/apple/connect",
    {
      method: "POST",
      credentials: "same-origin",
      headers: { ...headers(context), "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  await json(response);
}

async function disconnectExternalCalendar(
  context: HomiWebModuleHostContext,
  connectionId: string,
): Promise<void> {
  const response = await fetch(
    `/api/v1/modules/calendar/external/connections/${connectionId}`,
    { method: "DELETE", credentials: "same-origin", headers: headers(context) },
  );
  await json(response);
}

async function loadIcsFeeds(
  context: HomiWebModuleHostContext,
): Promise<readonly CalendarIcsFeedSnapshot[]> {
  const response = await fetch(
    "/api/v1/modules/calendar/ics/feeds",
    { credentials: "same-origin", headers: headers(context) },
  );
  const body = await json(response);
  if (!isObject(body) || !Array.isArray(body.data)) {
    throw new Error("ICS feed response is invalid.");
  }
  return Object.freeze(
    body.data.filter(isObject).map((item) => ({
      id: String(item.id),
      label: String(item.label),
      createdAt: String(item.createdAt),
      active: item.active === true,
    })),
  );
}

async function createIcsFeed(
  context: HomiWebModuleHostContext,
  label: string,
): Promise<string> {
  const response = await fetch(
    "/api/v1/modules/calendar/ics/feeds",
    {
      method: "POST",
      credentials: "same-origin",
      headers: { ...headers(context), "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    },
  );
  const body = await json(response);
  if (!isObject(body) || !isObject(body.data) || typeof body.data.feedUrl !== "string") {
    throw new Error("ICS feed creation response is invalid.");
  }
  return body.data.feedUrl;
}

async function regenerateIcsFeed(
  context: HomiWebModuleHostContext,
  feedId: string,
): Promise<string> {
  const response = await fetch(
    `/api/v1/modules/calendar/ics/feeds/${feedId}/regenerate`,
    { method: "POST", credentials: "same-origin", headers: headers(context) },
  );
  const body = await json(response);
  if (!isObject(body) || !isObject(body.data) || typeof body.data.feedUrl !== "string") {
    throw new Error("ICS feed regeneration response is invalid.");
  }
  return body.data.feedUrl;
}

async function revokeIcsFeed(
  context: HomiWebModuleHostContext,
  feedId: string,
): Promise<void> {
  const response = await fetch(
    `/api/v1/modules/calendar/ics/feeds/${feedId}`,
    { method: "DELETE", credentials: "same-origin", headers: headers(context) },
  );
  await json(response);
}

async function loadSettings(
  context: HomiWebModuleHostContext,
): Promise<CalendarSettingsSnapshot> {
  const response = await fetch(
    "/api/v1/modules/calendar/setup",
    {
      credentials: "same-origin",
      headers: headers(context),
    },
  );
  const body = await json(response);
  if (!isObject(body) || !isObject(body.data)) {
    throw new Error("Calendar settings response is invalid.");
  }
  const value = body.data;
  if (
    typeof value.state !== "string" ||
    typeof value.defaultView !== "string" ||
    typeof value.weekStart !== "string" ||
    typeof value.timeZone !== "string" ||
    typeof value.defaultReminder !== "string" ||
    typeof value.defaultCalendarId !== "string" ||
    typeof value.revision !== "string"
  ) {
    throw new Error("Calendar settings are invalid.");
  }
  return Object.freeze(value as unknown as CalendarSettingsSnapshot);
}

async function saveSettings(
  context: HomiWebModuleHostContext,
  input: {
    defaultView: string;
    weekStart: string;
    timeZone: string;
    defaultReminder: string;
    defaultCalendarId: string;
  },
): Promise<CalendarSettingsSnapshot> {
  const response = await fetch(
    "/api/v1/modules/calendar/setup",
    {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        ...headers(context),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );
  const body = await json(response);
  if (!isObject(body) || !isObject(body.data)) {
    throw new Error("Calendar settings response is invalid.");
  }
  return body.data as unknown as CalendarSettingsSnapshot;
}

async function loadCalendars(
  context: HomiWebModuleHostContext,
): Promise<readonly CalendarLayerSnapshot[]> {
  const response = await fetch(
    "/api/v1/modules/calendar/calendars",
    {
      credentials: "same-origin",
      headers: headers(context),
    },
  );
  const body = await json(response);
  if (!isObject(body) || !Array.isArray(body.data)) {
    throw new Error("Calendar list response is invalid.");
  }
  return Object.freeze(
    body.data.filter(isObject).map((value) =>
      Object.freeze(value as unknown as CalendarLayerSnapshot),
    ),
  );
}

async function loadPeople(
  context: HomiWebModuleHostContext,
): Promise<readonly CalendarPerson[]> {
  const response = await fetch(
    "/api/v1/modules/calendar/people",
    {
      credentials: "same-origin",
      headers: headers(context),
    },
  );
  const body = await json(response);
  if (!isObject(body) || !Array.isArray(body.data)) {
    throw new Error("Calendar people response is invalid.");
  }
  return Object.freeze(
    body.data.map((value) => {
      if (
        !isObject(value) ||
        typeof value.id !== "string" ||
        typeof value.displayName !== "string" ||
        !(value.avatarFileId === null || typeof value.avatarFileId === "string")
      ) {
        throw new Error("Calendar people response is invalid.");
      }
      return Object.freeze({
        id: value.id,
        displayName: value.displayName,
        avatarFileId: value.avatarFileId,
      });
    }),
  );
}

async function createCalendarLayer(
  context: HomiWebModuleHostContext,
  input: { id: string; name: string; color: CalendarColor },
): Promise<CalendarLayerSnapshot> {
  const response = await fetch(
    "/api/v1/modules/calendar/calendars",
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        ...headers(context),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );
  const body = await json(response);
  if (
    !isObject(body) ||
    !isObject(body.data) ||
    !isObject(body.data.calendar)
  ) {
    throw new Error("Calendar layer response is invalid.");
  }
  return body.data.calendar as unknown as CalendarLayerSnapshot;
}

async function updateCalendarLayer(
  context: HomiWebModuleHostContext,
  layer: CalendarLayerSnapshot,
  input: { name: string; color: CalendarColor },
): Promise<{ status: string; calendar: CalendarLayerSnapshot }> {
  const response = await fetch(
    `/api/v1/modules/calendar/calendars/${encodeURIComponent(layer.id)}`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        ...headers(context),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        baseRevision: layer.revision,
        ...input,
      }),
    },
  );
  const body = await json(response);
  if (
    !isObject(body) ||
    !isObject(body.data) ||
    typeof body.data.status !== "string" ||
    !isObject(body.data.calendar)
  ) {
    throw new Error("Calendar layer response is invalid.");
  }
  return {
    status: body.data.status,
    calendar: body.data.calendar as unknown as CalendarLayerSnapshot,
  };
}

async function deleteCalendarLayer(
  context: HomiWebModuleHostContext,
  layer: CalendarLayerSnapshot,
): Promise<void> {
  const response = await fetch(
    `/api/v1/modules/calendar/calendars/${encodeURIComponent(layer.id)}`,
    {
      method: "DELETE",
      credentials: "same-origin",
      headers: {
        ...headers(context),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ baseRevision: layer.revision }),
    },
  );
  await json(response);
}

async function loadCalendarMetadata(
  context: HomiWebModuleHostContext,
  actions: HomiWebModuleSurfaceProps["actions"],
): Promise<{
  settings: CalendarSettingsSnapshot | null;
  calendars: readonly CalendarLayerSnapshot[];
  people: readonly CalendarPerson[];
}> {
  if (context.online) {
    const [settings, calendars, people] = await Promise.all([
      loadSettings(context),
      loadCalendars(context),
      loadPeople(context),
    ]);
    await Promise.all([
      actions.replaceCachedEntities("calendar-settings", [
        {
          entityId: "settings",
          revision: settings.revision,
          data: settings,
        },
      ]),
      actions.replaceCachedEntities(
        "calendar-layer",
        calendars.map((calendar) => ({
          entityId: calendar.id,
          revision: calendar.revision,
          data: calendar,
        })),
      ),
      actions.replaceCachedEntities(
        "calendar-person",
        people.map((person) => ({
          entityId: person.id,
          revision: "0",
          data: person,
        })),
      ),
    ]);
    return { settings, calendars, people };
  }

  const [settingsRows, layerRows, personRows] = await Promise.all([
    actions.listCachedEntities("calendar-settings"),
    actions.listCachedEntities("calendar-layer"),
    actions.listCachedEntities("calendar-person"),
  ]);
  const settings = settingsRows[0]?.data;
  const cachedSettings = isObject(settings)
    ? settings as unknown as CalendarSettingsSnapshot
    : null;
  const calendars = layerRows
    .map((row) => row.data)
    .filter(isObject)
    .map((value) => value as unknown as CalendarLayerSnapshot)
    .sort((left, right) => left.name.localeCompare(right.name));
  const people = personRows
    .map((row) => row.data)
    .filter(isObject)
    .map((value) => value as unknown as CalendarPerson)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
  return {
    settings: cachedSettings,
    calendars: Object.freeze(calendars),
    people: Object.freeze(people),
  };
}

async function loadServerEvents(
  context: HomiWebModuleHostContext,
): Promise<readonly CalendarEvent[]> {
  const response = await fetch(
    "/api/v1/modules/calendar/events",
    {
      credentials: "same-origin",
      headers: headers(context),
    },
  );
  const body = await json(response);
  if (!isObject(body) || !Array.isArray(body.data)) {
    throw new Error("Calendar events response is invalid.");
  }
  return Object.freeze(body.data.map(parseCalendarEvent));
}

async function loadCachedEvents(
  actions: HomiWebModuleSurfaceProps["actions"],
): Promise<readonly CalendarEvent[]> {
  const records = await actions.listCachedEntities("event");
  const events: CalendarEvent[] = [];
  for (const record of records) {
    try {
      events.push(parseCalendarEvent(record.data));
    } catch {
      // Ignore a stale cache row; reconciliation will replace it.
    }
  }
  return Object.freeze(events);
}

function dateKey(
  value: Date,
  timeZone: string,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const fields = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthStart(value: string): string {
  return value.slice(0, 7) + "-01";
}

function nextMonth(value: string): string {
  const date = new Date(`${monthStart(value)}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function previousMonth(value: string): string {
  const date = new Date(`${monthStart(value)}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 10);
}

function wallTimeToIso(
  date: string,
  time: string,
  timeZone: string,
): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(
    year!, month! - 1, day!, hour!, minute!, 0,
  );
  let guess = desired;
  for (let index = 0; index < 5; index += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const fields = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    const observed = Date.UTC(
      Number(fields.year),
      Number(fields.month) - 1,
      Number(fields.day),
      Number(fields.hour),
      Number(fields.minute),
      0,
    );
    const correction = desired - observed;
    if (correction === 0) break;
    guess += correction;
  }
  return new Date(guess).toISOString();
}

function formatOccurrence(
  occurrence: CalendarOccurrence,
  locale: string,
  timeZone: string,
): string {
  if (occurrence.event.allDay) return "All day";
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(occurrence.event.startsAt!));
}

function useCalendarEvents(
  context: HomiWebModuleHostContext,
  actions: HomiWebModuleSurfaceProps["actions"],
) {
  const [events, setEvents] = useState<readonly CalendarEvent[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  async function reload(): Promise<void> {
    try {
      const next = context.online
        ? await loadServerEvents(context)
        : await loadCachedEvents(actions);
      if (context.online) {
        await actions.replaceCachedEntities(
          "event",
          next.map((event) => ({
            entityId: event.id,
            revision: event.revision,
            data: event,
          })),
        );
      }
      setEvents(next);
      setFailure(null);
    } catch (error) {
      const cached = await loadCachedEvents(actions).catch(() => []);
      setEvents(cached);
      setFailure(
        error instanceof Error
          ? error.message
          : "Calendar could not be loaded.",
      );
    }
  }

  useEffect(() => {
    void reload();
  }, [actions, context.householdId, context.online]);

  return { events, failure, reload };
}

function dateFromKey(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
}

function startOfWeekKey(
  value: string,
  weekStart: "sunday" | "monday",
): string {
  const date = dateFromKey(value);
  const target = weekStart === "monday" ? 1 : 0;
  date.setUTCDate(
    date.getUTCDate() -
      ((date.getUTCDay() - target + 7) % 7),
  );
  return date.toISOString().slice(0, 10);
}

function addMonths(value: string, amount: number): string {
  const date = dateFromKey(monthStart(value));
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 10);
}

function localClockMinutes(
  isoValue: string,
  timeZone: string,
): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(isoValue));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return Number(values.hour) * 60 + Number(values.minute);
}

function localInputValue(
  isoValue: string,
  timeZone: string,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(isoValue));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function calendarEditorFromOccurrence(
  occurrence: CalendarOccurrence,
  seriesEvent: CalendarEvent,
): CalendarEditorState {
  const event = occurrence.event;
  const anchor = occurrence.occurrenceDate;
  return {
    kind: "edit",
    seriesEvent,
    occurrence,
    editScope: seriesEvent.recurrence ? "occurrence" : "series",
    calendarId: event.calendarId,
    color: event.color,
    title: event.title,
    description: event.description ?? "",
    allDay: event.allDay,
    timeZone: event.timeZone,
    startsAt: event.startsAt
      ? localInputValue(event.startsAt, event.timeZone)
      : `${anchor}T09:00`,
    endsAt: event.endsAt
      ? localInputValue(event.endsAt, event.timeZone)
      : `${anchor}T10:00`,
    startDate: event.startDate ?? anchor,
    endDateExclusive:
      event.endDateExclusive ?? addDays(anchor, 1),
    location: event.location ?? "",
    notes: event.notes ?? "",
    recurrenceFrequency:
      seriesEvent.recurrence?.frequency ?? "none",
    recurrenceInterval: String(
      seriesEvent.recurrence?.interval ?? 1,
    ),
    recurrenceEndDate:
      seriesEvent.recurrence?.endDate ?? "",
    recurrenceWeekdays:
      seriesEvent.recurrence?.weekdays ?? [
        dateFromKey(anchor).getUTCDay(),
      ],
    personIds: event.personIds,
    reminderMinutes: event.reminderMinutes,
    transportMode: event.transport.mode,
    pickupPersonId: event.transport.pickupPersonId ?? "",
    dropoffPersonId: event.transport.dropoffPersonId ?? "",
    transportNotes: event.transport.notes ?? "",
  };
}

function newCalendarEditor(
  date: string,
  calendarId: string,
  color: CalendarColor,
  timeZone: string,
  defaultReminder: string,
): CalendarEditorState {
  return {
    kind: "create",
    seriesEvent: null,
    occurrence: null,
    editScope: "series",
    calendarId,
    color,
    title: "",
    description: "",
    allDay: false,
    timeZone,
    startsAt: `${date}T09:00`,
    endsAt: `${date}T10:00`,
    startDate: date,
    endDateExclusive: addDays(date, 1),
    location: "",
    notes: "",
    recurrenceFrequency: "none",
    recurrenceInterval: "1",
    recurrenceEndDate: "",
    recurrenceWeekdays: [dateFromKey(date).getUTCDay()],
    personIds: [],
    reminderMinutes:
      defaultReminder === "30m"
        ? [30]
        : defaultReminder === "1h"
          ? [60]
          : [],
    transportMode: "none",
    pickupPersonId: "",
    dropoffPersonId: "",
    transportNotes: "",
  };
}

function CalendarTimeGrid({
  days,
  occurrences,
  timeZone,
  colorFor,
  onEdit,
}: {
  days: readonly string[];
  occurrences: readonly CalendarOccurrence[];
  timeZone: string;
  colorFor(occurrence: CalendarOccurrence): string;
  onEdit(occurrence: CalendarOccurrence): void;
}) {
  const hourHeight = 42;
  const height = hourHeight * 24;
  const allDay = occurrences.filter(
    (item) => item.event.allDay,
  );
  return (
    <div className="homi-calendar-time-workspace">
      <div className="homi-calendar-all-day-row">
        <div className="homi-calendar-time-label">All day</div>
        {days.map((day) => (
          <div key={day} className="homi-calendar-all-day-cell">
            {allDay
              .filter((item) => item.occurrenceDate === day)
              .map((item) => (
                <button
                  type="button"
                  key={item.occurrenceId}
                  className="homi-calendar-chip"
                  style={{
                    borderInlineStartColor: colorFor(item),
                  }}
                  onClick={() => onEdit(item)}
                >
                  {item.event.title}
                </button>
              ))}
          </div>
        ))}
      </div>
      <div className="homi-calendar-time-grid">
        <div className="homi-calendar-hour-labels" style={{ height }}>
          {Array.from({ length: 24 }).map((_, hour) => (
            <span
              key={hour}
              style={{ top: hour * hourHeight }}
            >
              {new Intl.DateTimeFormat(undefined, {
                hour: "numeric",
                timeZone: "UTC",
              }).format(new Date(Date.UTC(2026, 0, 1, hour)))}
            </span>
          ))}
        </div>
        {days.map((day) => {
          const timed = occurrences.filter(
            (item) =>
              !item.event.allDay &&
              item.occurrenceDate === day,
          );
          return (
            <div
              key={day}
              className="homi-calendar-time-column"
              style={{ height }}
            >
              {Array.from({ length: 24 }).map((_, hour) => (
                <span
                  key={hour}
                  className="homi-calendar-hour-line"
                  style={{ top: hour * hourHeight }}
                />
              ))}
              {timed.map((item) => {
                const start = localClockMinutes(
                  item.event.startsAt!,
                  timeZone,
                );
                const end = localClockMinutes(
                  item.event.endsAt!,
                  timeZone,
                );
                const duration = Math.max(30, end - start);
                return (
                  <button
                    type="button"
                    key={item.occurrenceId}
                    className="homi-calendar-time-event"
                    style={{
                      top: (start / 60) * hourHeight,
                      minHeight: 30,
                      height: (duration / 60) * hourHeight,
                      borderInlineStartColor: colorFor(item),
                    }}
                    onClick={() => onEdit(item)}
                  >
                    <strong>{item.event.title}</strong>
                    <span>
                      {formatOccurrence(item, "en", timeZone)}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarPage({
  context,
  actions,
}: HomiWebModuleSurfaceProps) {
  const { events, failure, reload } = useCalendarEvents(
    context,
    actions,
  );
  const [settings, setSettings] =
    useState<CalendarSettingsSnapshot | null>(null);
  const [calendars, setCalendars] = useState<
    readonly CalendarLayerSnapshot[]
  >([]);
  const [people, setPeople] = useState<readonly CalendarPerson[]>([]);
  const [view, setView] = useState<CalendarView>(() =>
    rememberedCalendarView(context) ?? "week",
  );
  const [viewInitialized, setViewInitialized] = useState(false);
  const today = dateKey(new Date(), context.timeZone);
  const [cursor, setCursor] = useState(today);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [editor, setEditor] = useState<CalendarEditorState | null>(null);
  const [externalDetail, setExternalDetail] =
    useState<CalendarOccurrence | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chequebookOpen, setChequebookOpen] = useState(false);
  const [chequebookOptions, setChequebookOptions] =
    useState<CalendarChequebookOptions | null>(null);
  const [chequebookAccountId, setChequebookAccountId] = useState("");
  const [chequebookCategoryId, setChequebookCategoryId] = useState("");
  const [chequebookKind, setChequebookKind] =
    useState<"expense" | "income">("expense");
  const [chequebookAmount, setChequebookAmount] = useState("");

  useEffect(() => {
    actions.registerContextActions({
      search: {
        label: "Search Calendar",
        invoke: () => setSearchOpen((current) => !current),
      },
      create: {
        label: "Add event",
        available: calendars.length > 0,
        invoke: () => openCreate(cursor),
      },
    });
    return () => actions.registerContextActions(null);
  }, [calendars.length, cursor]);

  const reloadMetadata = useCallback(async () => {
    const metadata = await loadCalendarMetadata(context, actions);
    const nextSettings = metadata.settings;
    const nextCalendars = metadata.calendars;
    const nextPeople = metadata.people;
    setSettings(nextSettings);
    setCalendars(nextCalendars);
    setPeople(nextPeople);
    const remembered = rememberedCalendarView(context);
    const configured = isCalendarView(nextSettings?.defaultView)
      ? nextSettings.defaultView
      : "week";
    setView(remembered ?? configured);
    setViewInitialized(true);
  }, [actions, context.householdId, context.online]);

  useEffect(() => {
    void reloadMetadata().catch((error: unknown) =>
      setMessage(
        error instanceof Error
          ? error.message
          : "Calendar details could not be loaded.",
      ),
    );
  }, [reloadMetadata]);

  useEffect(() => {
    if (!viewInitialized) return;
    rememberCalendarView(context, view);
  }, [context.authSubject, context.householdId, view, viewInitialized]);

  const weekStart =
    settings?.weekStart === "monday" ? "monday" : "sunday";
  const effectiveTimeZone = settings?.timeZone ?? context.timeZone;
  const visibleEvents = events;
  const peopleById = new Map(
    people.map((person) => [person.id, person] as const),
  );
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase(context.locale);
  const searchedEvents = visibleEvents.filter((event) => {
    if (!normalizedSearch) return true;
    const related = new Set(event.personIds);
    if (event.transport.pickupPersonId) {
      related.add(event.transport.pickupPersonId);
    }
    if (event.transport.dropoffPersonId) {
      related.add(event.transport.dropoffPersonId);
    }
    return [
      event.title,
      event.description ?? "",
      event.location ?? "",
      event.notes ?? "",
      ...[...related].map(
        (id) => peopleById.get(id)?.displayName ?? "",
      ),
    ]
      .join("\n")
      .toLocaleLowerCase(context.locale)
      .includes(normalizedSearch);
  });

  const viewRange = useMemo(() => {
    if (view === "day") {
      return { start: cursor, end: addDays(cursor, 1) };
    }
    if (view === "week") {
      const start = startOfWeekKey(cursor, weekStart);
      return { start, end: addDays(start, 7) };
    }
    if (view === "month") {
      const start = monthStart(cursor);
      return { start, end: nextMonth(start) };
    }
    return { start: today, end: addDays(today, 90) };
  }, [view, cursor, weekStart, today]);

  const occurrences = useMemo(
    () => expandCalendarEvents(
      searchedEvents,
      viewRange.start,
      viewRange.end,
    ),
    [searchedEvents, viewRange.start, viewRange.end],
  );

  const calendarById = new Map(
    calendars.map((calendar) => [calendar.id, calendar] as const),
  );
  function colorFor(item: CalendarOccurrence): string {
    const key = item.event.color ??
      calendarById.get(item.event.calendarId)?.color ??
      "blue";
    return CALENDAR_COLORS[key] ?? CALENDAR_COLORS.blue;
  }

  function sourceEvent(item: CalendarOccurrence): CalendarEvent | null {
    return events.find((event) => event.id === item.seriesEventId) ?? null;
  }

  function openCreate(date = cursor): void {
    const calendarId =
      settings?.defaultCalendarId ?? calendars[0]?.id;
    if (!calendarId) {
      setMessage("Complete Calendar setup before adding events.");
      return;
    }
    const color =
      calendars.find((calendar) => calendar.id === calendarId)?.color ?? "blue";
    setEditor(
      newCalendarEditor(
        date,
        calendarId,
        color,
        effectiveTimeZone,
        settings?.defaultReminder ?? "none",
      ),
    );
  }

  function openEdit(item: CalendarOccurrence): void {
    const series = sourceEvent(item);
    if (!series) return;
    if (series.source === "external") {
      setExternalDetail(item);
      return;
    }
    setEditor(calendarEditorFromOccurrence(item, series));
  }

  function editorPayload(current: CalendarEditorState) {
    const interval = Number(current.recurrenceInterval);
    if (
      current.recurrenceFrequency !== "none" &&
      (!Number.isSafeInteger(interval) || interval < 1 || interval > 99)
    ) {
      throw new Error("Repeat interval must be a whole number from 1 to 99.");
    }
    if (
      current.recurrenceFrequency === "weekly" &&
      current.recurrenceWeekdays.length === 0
    ) {
      throw new Error("Choose at least one weekday for weekly recurrence.");
    }
    const recurrence =
      current.recurrenceFrequency === "none"
        ? null
        : {
            frequency: current.recurrenceFrequency,
            interval,
            weekdays:
              current.recurrenceFrequency === "weekly"
                ? [...current.recurrenceWeekdays].sort((a, b) => a - b)
                : [],
            endDate: current.recurrenceEndDate || null,
          };
    const transport = {
      mode: current.transportMode,
      pickupPersonId:
        current.transportMode === "pickup" ||
        current.transportMode === "round-trip"
          ? current.pickupPersonId || null
          : null,
      dropoffPersonId:
        current.transportMode === "dropoff" ||
        current.transportMode === "round-trip"
          ? current.dropoffPersonId || null
          : null,
      notes: current.transportNotes.trim() || null,
    };
    if (
      (current.transportMode === "pickup" ||
        current.transportMode === "round-trip") &&
      !transport.pickupPersonId
    ) {
      throw new Error("Choose who is handling pickup.");
    }
    if (
      (current.transportMode === "dropoff" ||
        current.transportMode === "round-trip") &&
      !transport.dropoffPersonId
    ) {
      throw new Error("Choose who is handling drop-off.");
    }
    const shared = {
      calendarId: current.calendarId,
      color: current.color,
      title: current.title.trim(),
      description: current.description.trim() || null,
      timeZone: current.timeZone,
      location: current.location.trim() || null,
      notes: current.notes.trim() || null,
      personIds: [...current.personIds],
      reminderMinutes: [...current.reminderMinutes].sort((a, b) => a - b),
      transport,
    };
    if (!shared.title) throw new Error("Event title is required.");
    if (current.allDay) {
      if (
        current.endDateExclusive <= current.startDate
      ) {
        throw new Error("All-day event end date must be after its start date.");
      }
      return {
        ...shared,
        allDay: true,
        startsAt: null,
        endsAt: null,
        startDate: current.startDate,
        endDateExclusive: current.endDateExclusive,
        recurrence,
      };
    }
    const [startDate, startTime] = current.startsAt.split("T");
    const [endDate, endTime] = current.endsAt.split("T");
    if (!startDate || !startTime || !endDate || !endTime) {
      throw new Error("Event start and end are required.");
    }
    const startsAt = wallTimeToIso(
      startDate,
      startTime,
      current.timeZone,
    );
    const endsAt = wallTimeToIso(
      endDate,
      endTime,
      current.timeZone,
    );
    if (endsAt <= startsAt) {
      throw new Error("Event end time must be after its start time.");
    }
    return {
      ...shared,
      allDay: false,
      startsAt,
      endsAt,
      startDate: null,
      endDateExclusive: null,
      recurrence,
    };
  }

  async function openChequebookLink(): Promise<void> {
    if (!context.online) {
      setMessage("Reconnect before linking this event to Chequebook.");
      return;
    }
    try {
      const options = await loadChequebookOptions(context);
      if (!options.configured || options.accounts.length === 0) {
        setMessage(
          "Install, enable, and set up Chequebook before linking this recurring event.",
        );
        return;
      }
      setChequebookOptions(options);
      setChequebookAccountId(
        options.defaultAccountId ?? options.accounts[0]?.id ?? "",
      );
      const expenseCategory = options.categories.find(
        (item) => item.kind === "expense" || item.kind === "both",
      );
      setChequebookCategoryId(expenseCategory?.id ?? "");
      setChequebookKind("expense");
      setChequebookAmount("");
      setChequebookOpen(true);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Install and enable Chequebook from Modules to use this feature.",
      );
    }
  }

  async function linkEditorToChequebook(): Promise<void> {
    const series = editor?.seriesEvent;
    if (!series || !series.recurrence || !chequebookAmount) return;
    setBusy(true);
    try {
      await saveChequebookRecurringLink(
        context,
        series.id,
        {
          enabled: true,
          accountId: chequebookAccountId,
          categoryId: chequebookCategoryId || null,
          kind: chequebookKind,
          amount: chequebookAmount,
        },
      );
      setChequebookOpen(false);
      setMessage("Recurring event added to the household Chequebook.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The recurring event could not be added to Chequebook.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function finishEventMutation(messageText: string): Promise<void> {
    if (context.online) {
      await actions.syncNow();
      await reload();
    }
    setEditor(null);
    setMessage(
      context.online
        ? messageText
        : `${messageText} It is queued offline.`,
    );
  }

  async function saveEditor(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!editor || busy) return;
    setBusy(true);
    try {
      const payload = editorPayload(editor);
      if (editor.kind === "create") {
        await actions.enqueueMutation({
          entityType: "event",
          entityId: crypto.randomUUID(),
          operation: "create",
          baseRevision: "0",
          payload: {
            ...payload,
            recurrenceOverrides: [],
          },
        });
      } else if (
        editor.editScope === "occurrence" &&
        editor.seriesEvent?.recurrence &&
        editor.occurrence
      ) {
        const replacement = {
          calendarId: payload.calendarId,
          color: payload.color,
          title: payload.title,
          description: payload.description,
          allDay: payload.allDay,
          timeZone: payload.timeZone,
          startsAt: payload.startsAt,
          endsAt: payload.endsAt,
          startDate: payload.startDate,
          endDateExclusive: payload.endDateExclusive,
          location: payload.location,
          notes: payload.notes,
          personIds: payload.personIds,
          reminderMinutes: payload.reminderMinutes,
          transport: payload.transport,
        };
        const nextOverrides = [
          ...editor.seriesEvent.recurrenceOverrides.filter(
            (item) =>
              item.occurrenceDate !== editor.occurrence!.occurrenceDate,
          ),
          {
            occurrenceDate: editor.occurrence.occurrenceDate,
            action: "replace" as const,
            replacement,
          },
        ];
        await actions.enqueueMutation({
          entityType: "event",
          entityId: editor.seriesEvent.id,
          operation: "update",
          baseRevision: editor.seriesEvent.revision,
          payload: { recurrenceOverrides: nextOverrides },
        });
      } else {
        const series = editor.seriesEvent;
        if (!series) throw new Error("Calendar event is unavailable.");
        const recurrenceChanged =
          JSON.stringify(series.recurrence) !==
          JSON.stringify(payload.recurrence);
        await actions.enqueueMutation({
          entityType: "event",
          entityId: series.id,
          operation: "update",
          baseRevision: series.revision,
          payload: {
            ...payload,
            recurrenceOverrides:
              payload.recurrence === null || recurrenceChanged
                ? []
                : series.recurrenceOverrides,
          },
        });
      }
      await finishEventMutation("Event saved.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The event could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteEditorEvent(): Promise<void> {
    if (!editor?.seriesEvent || busy) return;
    setBusy(true);
    try {
      if (
        editor.editScope === "occurrence" &&
        editor.seriesEvent.recurrence &&
        editor.occurrence
      ) {
        const nextOverrides = [
          ...editor.seriesEvent.recurrenceOverrides.filter(
            (item) =>
              item.occurrenceDate !== editor.occurrence!.occurrenceDate,
          ),
          {
            occurrenceDate: editor.occurrence.occurrenceDate,
            action: "skip" as const,
            replacement: null,
          },
        ];
        await actions.enqueueMutation({
          entityType: "event",
          entityId: editor.seriesEvent.id,
          operation: "update",
          baseRevision: editor.seriesEvent.revision,
          payload: { recurrenceOverrides: nextOverrides },
        });
        await finishEventMutation("Occurrence removed.");
      } else {
        await actions.enqueueMutation({
          entityType: "event",
          entityId: editor.seriesEvent.id,
          operation: "delete",
          baseRevision: editor.seriesEvent.revision,
          payload: {},
        });
        await finishEventMutation("Event deleted.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The event could not be deleted.",
      );
    } finally {
      setBusy(false);
    }
  }

  function movePeriod(amount: number): void {
    if (view === "day") setCursor(addDays(cursor, amount));
    else if (view === "week") setCursor(addDays(cursor, amount * 7));
    else if (view === "month") setCursor(addMonths(cursor, amount));
    else setCursor(addDays(cursor, amount * 14));
  }

  const weekDays = Array.from({ length: 7 }).map((_, index) =>
    addDays(startOfWeekKey(cursor, weekStart), index),
  );
  const periodLabel = (() => {
    if (view === "day") {
      return new Intl.DateTimeFormat(context.locale, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(dateFromKey(cursor));
    }
    if (view === "week") {
      return `${weekDays[0]} – ${weekDays[6]}`;
    }
    if (view === "month") {
      return new Intl.DateTimeFormat(context.locale, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(dateFromKey(monthStart(cursor)));
    }
    return "Upcoming";
  })();

  function openMonthDate(
    date: string,
    items: readonly CalendarOccurrence[],
  ): void {
    setCursor(date);
    if (items.length === 0) {
      openCreate(date);
      return;
    }
    setView("day");
  }

  const renderMonth = () => {
    const start = monthStart(cursor);
    const first = dateFromKey(start).getUTCDay();
    const days = new Date(
      Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0),
    ).getUTCDate();
    return (
      <div className="homi-calendar-month-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
          (label) => <strong key={label}>{label}</strong>,
        )}
        {Array.from({ length: first }).map((_, index) => (
          <span key={`blank-${index}`} />
        ))}
        {Array.from({ length: days }).map((_, index) => {
          const day = index + 1;
          const key = `${start.slice(0, 8)}${String(day).padStart(2, "0")}`;
          const items = occurrences.filter(
            (item) => item.occurrenceDate === key,
          );
          return (
            <div
              key={key}
              className={[
                "homi-calendar-month-cell",
                key === today ? "is-today" : "",
                key === cursor ? "is-selected" : "",
              ].join(" ")}
              onClick={() => openMonthDate(key, items)}
            >
              <button
                type="button"
                className="homi-calendar-date-button"
                onClick={(event) => {
                  event.stopPropagation();
                  openMonthDate(key, items);
                }}
              >
                {day}
              </button>
              <div className="homi-calendar-month-events">
                {items.slice(0, 3).map((item) => (
                  <button
                    type="button"
                    key={item.occurrenceId}
                    className="homi-calendar-month-event"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEdit(item);
                    }}
                  >
                    <span
                      className="homi-calendar-color-dot"
                      style={{ background: colorFor(item) }}
                    />
                    <span>{item.event.title}</span>
                  </button>
                ))}
                {items.length > 3 && (
                  <small>+{items.length - 3} more</small>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderUpcoming = () => (
    <div style={stackStyle}>
      {occurrences.length === 0 ? (
        <p>No upcoming events.</p>
      ) : (
        occurrences.slice(0, 80).map((item) => (
          <button
            type="button"
            key={item.occurrenceId}
            className="homi-calendar-upcoming-row"
            onClick={() => openEdit(item)}
          >
            <span
              className="homi-calendar-upcoming-bar"
              style={{ background: colorFor(item) }}
            />
            <span className="homi-calendar-upcoming-date">
              {item.occurrenceDate}
            </span>
            <span className="homi-calendar-upcoming-main">
              <strong>{item.event.title}</strong>
              <small>
                {item.event.location ??
                  calendarById.get(item.event.calendarId)?.name ?? "Calendar"}
              </small>
            </span>
            <span>{formatOccurrence(item, context.locale, effectiveTimeZone)}</span>
          </button>
        ))
      )}
    </div>
  );


  return (
    <section className="homi-calendar-module">
      <style>{`
        .homi-calendar-module{display:grid;gap:var(--homi-space-4)}
        .homi-calendar-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
        .homi-calendar-toolbar__nav{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        .homi-calendar-workspace{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--homi-space-4);align-items:start}
        .homi-calendar-main{min-width:0;display:grid;gap:12px}
        .homi-calendar-search-popover{position:fixed;right:max(18px,env(safe-area-inset-right));bottom:calc(146px + env(safe-area-inset-bottom));z-index:45;width:min(360px,calc(100vw - 36px));box-shadow:var(--homi-shadow-lg)}
        .homi-calendar-view-surface{min-width:0;width:100%;overflow:hidden}
        .homi-calendar-week-scroll{min-width:0;width:100%;max-width:100%;overflow-x:auto;overscroll-behavior-inline:contain}
        .homi-calendar-week-content{min-width:960px}
        .homi-calendar-week-content .homi-calendar-time-workspace{overflow:visible}
        .homi-calendar-month-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
        .homi-calendar-month-grid>strong{padding:7px;text-align:center;color:var(--homi-text-muted);font-size:.72rem}
        .homi-calendar-month-cell{min-height:112px;border:1px solid var(--homi-border);border-radius:var(--homi-radius-md);padding:7px;background:var(--homi-surface-strong);overflow:hidden;cursor:pointer}
        .homi-calendar-month-cell.is-today{box-shadow:0 0 0 2px var(--homi-primary-soft);border-color:var(--homi-primary)}
        .homi-calendar-month-cell.is-selected{background:var(--homi-bg-soft)}
        .homi-calendar-date-button{border:0;background:transparent;color:var(--homi-text);font:inherit;font-weight:800;cursor:pointer;padding:2px 4px}
        .homi-calendar-month-events{display:grid;gap:4px;margin-top:5px}
        .homi-calendar-month-event{display:grid;grid-template-columns:7px minmax(0,1fr);gap:6px;align-items:center;border:0;background:transparent;padding:3px;text-align:left;color:var(--homi-text);cursor:pointer;font:inherit;font-size:.72rem}
        .homi-calendar-month-event span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .homi-calendar-color-dot{width:7px;height:7px;border-radius:999px}
        .homi-calendar-time-workspace{overflow:auto;border:1px solid var(--homi-border);border-radius:var(--homi-radius-md);background:var(--homi-surface-strong)}
        .homi-calendar-all-day-row,.homi-calendar-time-grid{display:grid;grid-template-columns:64px repeat(var(--calendar-day-count),minmax(128px,1fr));min-width:max-content}
        .homi-calendar-time-label{padding:8px;color:var(--homi-text-muted);font-size:.72rem}
        .homi-calendar-all-day-cell{min-height:44px;padding:5px;border-left:1px solid var(--homi-border)}
        .homi-calendar-chip{display:block;width:100%;border:0;border-inline-start:4px solid var(--homi-primary);border-radius:8px;background:var(--homi-bg-soft);padding:5px 7px;text-align:left;color:var(--homi-text);cursor:pointer;font:inherit;font-size:.72rem}
        .homi-calendar-hour-labels{position:relative;width:64px}
        .homi-calendar-hour-labels span{position:absolute;right:8px;transform:translateY(-50%);color:var(--homi-text-muted);font-size:.68rem}
        .homi-calendar-time-column{position:relative;border-left:1px solid var(--homi-border);min-width:128px}
        .homi-calendar-hour-line{position:absolute;left:0;right:0;border-top:1px solid var(--homi-border)}
        .homi-calendar-time-event{position:absolute;left:4px;right:4px;border:0;border-inline-start:5px solid var(--homi-primary);border-radius:9px;background:var(--homi-bg-soft);padding:5px 7px;text-align:left;overflow:hidden;color:var(--homi-text);cursor:pointer;font:inherit}
        .homi-calendar-time-event strong,.homi-calendar-time-event span{display:block;font-size:.7rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .homi-calendar-upcoming-row{display:grid;grid-template-columns:5px 92px minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid var(--homi-border);border-radius:var(--homi-radius-md);background:var(--homi-surface-strong);padding:10px;text-align:left;color:var(--homi-text);cursor:pointer;font:inherit}
        .homi-calendar-upcoming-bar{align-self:stretch;border-radius:999px}
        .homi-calendar-upcoming-main{display:grid;gap:3px}
        .homi-calendar-upcoming-main small{color:var(--homi-text-muted)}
        .homi-calendar-editor-backdrop{position:fixed;inset:0;z-index:50;background:rgba(20,20,20,.42);display:grid;place-items:center;padding:18px;overflow:auto}
        .homi-calendar-editor{width:min(780px,100%);max-height:calc(100vh - 36px);overflow:auto;display:grid;gap:16px}
        .homi-calendar-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
        .homi-calendar-checkboxes{display:flex;flex-wrap:wrap;gap:10px}
        .homi-calendar-checkboxes label{display:flex;align-items:center;gap:6px}
        .homi-calendar-editor-actions{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
        @media(min-width:900px){.homi-calendar-search-popover{bottom:88px}}
        @media(max-width:760px){.homi-calendar-month-cell{min-height:72px;padding:5px}.homi-calendar-month-event{display:none}.homi-calendar-form-grid{grid-template-columns:1fr}.homi-calendar-upcoming-row{grid-template-columns:5px 72px minmax(0,1fr)}.homi-calendar-upcoming-row>span:last-child{display:none}.homi-calendar-toolbar__nav input[type=date]{max-width:142px}}
      `}</style>

      <ModuleHeader
        eyebrow="Family schedule"
        title="Calendar"
        description="One household schedule, with each person free to choose the Calendar views they want on Home."
        actions={
          <Badge tone={context.online ? "success" : "warning"}>
            {context.online ? "Synced" : "Offline"}
          </Badge>
        }
      />

      {failure && (
        <Notice tone="warning" title="Using cached Calendar data">
          {failure}
        </Notice>
      )}
      {message && <Notice>{message}</Notice>}

      <div className="homi-calendar-toolbar">
        <Tabs
          label="Calendar view"
          activeId={view}
          onChange={(nextView) => {
            if (isCalendarView(nextView)) setView(nextView);
          }}
          items={[
            { id: "day", label: "Day" },
            { id: "week", label: "Week" },
            { id: "month", label: "Month" },
            { id: "upcoming", label: "Upcoming" },
          ]}
        />
        <div className="homi-calendar-toolbar__nav">
          <Button variant="quiet" onClick={() => movePeriod(-1)}>Previous</Button>
          <Button variant="quiet" onClick={() => setCursor(today)}>Today</Button>
          <TextField
            type="date"
            aria-label="Choose date"
            value={cursor}
            onChange={(event) => setCursor(event.currentTarget.value)}
          />
          <Button variant="quiet" onClick={() => movePeriod(1)}>Next</Button>
        </div>
      </div>

      <div className="homi-calendar-workspace">
        <main className="homi-calendar-main">
          <Surface className="homi-calendar-view-surface" padding="normal">
            <div style={{ marginBottom: 14 }}>
              <strong style={{ fontSize: "1.15rem" }}>{periodLabel}</strong>
              {normalizedSearch && (
                <p style={{ color: "var(--homi-text-muted)" }}>
                  Showing matches for “{searchQuery.trim()}”.
                </p>
              )}
            </div>
            {view === "month" && renderMonth()}
            {view === "upcoming" && renderUpcoming()}
            {view === "day" && (
              <div style={{ "--calendar-day-count": 1 } as CSSProperties}>
                <CalendarTimeGrid
                  days={[cursor]}
                  occurrences={occurrences}
                  timeZone={effectiveTimeZone}
                  colorFor={colorFor}
                  onEdit={openEdit}
                />
              </div>
            )}
            {view === "week" && (
              <div className="homi-calendar-week-scroll">
                <div
                  className="homi-calendar-week-content"
                  style={{ "--calendar-day-count": 7 } as CSSProperties}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "64px repeat(7,minmax(128px,1fr))",
                      marginBottom: 6,
                    }}
                  >
                    <span />
                    {weekDays.map((day) => (
                      <button
                        type="button"
                        key={day}
                        className="homi-calendar-date-button"
                        onClick={() => {
                          setCursor(day);
                          setView("day");
                        }}
                      >
                        {new Intl.DateTimeFormat(context.locale, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        }).format(dateFromKey(day))}
                      </button>
                    ))}
                  </div>
                  <CalendarTimeGrid
                    days={weekDays}
                    occurrences={occurrences}
                    timeZone={effectiveTimeZone}
                    colorFor={colorFor}
                    onEdit={openEdit}
                  />
                </div>
              </div>
            )}
          </Surface>
        </main>
      </div>

      {searchOpen && (
        <Surface className="homi-calendar-search-popover" padding="compact">
          <FormField label="Search Calendar" htmlFor="calendar-search">
            <TextField
              id="calendar-search"
              type="search"
              autoFocus
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder="Events, notes, places or people"
            />
          </FormField>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <Button
              variant="quiet"
              onClick={() => {
                setSearchQuery("");
                setSearchOpen(false);
              }}
            >
              Close
            </Button>
          </div>
        </Surface>
      )}

      {externalDetail && (
        <div
          className="homi-calendar-editor-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setExternalDetail(null);
            }
          }}
        >
          <Surface className="homi-calendar-editor" padding="normal">
            <ModuleHeader
              eyebrow="External calendar"
              title={externalDetail.event.title}
              description="This event is synchronized from an external provider and is read-only in Homi."
              actions={<Badge tone="neutral">Read-only</Badge>}
            />
            <div style={stackStyle}>
              <div className="homi-calendar-form-grid">
                <div>
                  <strong>When</strong>
                  <p>{formatOccurrence(externalDetail, context.locale, effectiveTimeZone)}</p>
                </div>
                <div>
                  <strong>Provider</strong>
                  <p>
                    {sourceEvent(externalDetail)?.externalProvider ?? "External calendar"}
                  </p>
                </div>
                {externalDetail.event.location && (
                  <div>
                    <strong>Location</strong>
                    <p>{externalDetail.event.location}</p>
                  </div>
                )}
                {externalDetail.event.description && (
                  <div>
                    <strong>Description</strong>
                    <p>{externalDetail.event.description}</p>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button onClick={() => setExternalDetail(null)}>Close</Button>
              </div>
            </div>
          </Surface>
        </div>
      )}

      {editor && (
        <div
          className="homi-calendar-editor-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setEditor(null);
          }}
        >
          <Surface className="homi-calendar-editor" padding="normal">
            <ModuleHeader
              eyebrow={editor.kind === "create" ? "New event" : "Event details"}
              title={editor.kind === "create" ? "Add to Calendar" : editor.title || "Calendar event"}
              description="Calendar details synchronize through Homi and remain available offline."
            />
            {editor.seriesEvent?.recurrence && (
              <Tabs
                label="Edit scope"
                activeId={editor.editScope}
                onChange={(id) =>
                  setEditor({ ...editor, editScope: id as "series" | "occurrence" })
                }
                items={[
                  { id: "occurrence", label: "This occurrence" },
                  { id: "series", label: "Entire series" },
                ]}
              />
            )}
            <form onSubmit={(event) => void saveEditor(event)} style={stackStyle}>
              <div className="homi-calendar-form-grid">
                <FormField label="Event" htmlFor="calendar-editor-title">
                  <TextField
                    id="calendar-editor-title"
                    value={editor.title}
                    maxLength={200}
                    onChange={(event) => setEditor({ ...editor, title: event.currentTarget.value })}
                    required
                  />
                </FormField>
                <FormField label="Calendar" htmlFor="calendar-editor-layer">
                  <Select
                    id="calendar-editor-layer"
                    value={editor.calendarId}
                    onChange={(event) => setEditor({ ...editor, calendarId: event.currentTarget.value })}
                  >
                    {calendars.map((calendar) => (
                      <option key={calendar.id} value={calendar.id}>{calendar.name}</option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Event color" htmlFor="calendar-editor-color">
                  <Select
                    id="calendar-editor-color"
                    value={editor.color}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        color: event.currentTarget.value as CalendarColor,
                      })
                    }
                  >
                    {Object.entries(CALENDAR_COLORS).map(([color, value]) => (
                      <option key={color} value={color}>
                        {color} · {value}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Description" htmlFor="calendar-editor-description">
                  <TextField
                    id="calendar-editor-description"
                    value={editor.description}
                    onChange={(event) => setEditor({ ...editor, description: event.currentTarget.value })}
                  />
                </FormField>
                <FormField label="Location" htmlFor="calendar-editor-location">
                  <TextField
                    id="calendar-editor-location"
                    value={editor.location}
                    onChange={(event) => setEditor({ ...editor, location: event.currentTarget.value })}
                  />
                </FormField>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={editor.allDay}
                  onChange={(event) => setEditor({ ...editor, allDay: event.currentTarget.checked })}
                />
                All-day event
              </label>

              <div className="homi-calendar-form-grid">
                {editor.allDay ? (
                  <>
                    <FormField label="Starts" htmlFor="calendar-editor-start-date">
                      <TextField
                        id="calendar-editor-start-date"
                        type="date"
                        value={editor.startDate}
                        onChange={(event) => setEditor({ ...editor, startDate: event.currentTarget.value })}
                      />
                    </FormField>
                    <FormField label="Ends" htmlFor="calendar-editor-end-date">
                      <TextField
                        id="calendar-editor-end-date"
                        type="date"
                        value={editor.endDateExclusive}
                        onChange={(event) => setEditor({ ...editor, endDateExclusive: event.currentTarget.value })}
                      />
                    </FormField>
                  </>
                ) : (
                  <>
                    <FormField label="Starts" htmlFor="calendar-editor-start">
                      <TextField
                        id="calendar-editor-start"
                        type="datetime-local"
                        value={editor.startsAt}
                        onChange={(event) => setEditor({ ...editor, startsAt: event.currentTarget.value })}
                      />
                    </FormField>
                    <FormField label="Ends" htmlFor="calendar-editor-end">
                      <TextField
                        id="calendar-editor-end"
                        type="datetime-local"
                        value={editor.endsAt}
                        onChange={(event) => setEditor({ ...editor, endsAt: event.currentTarget.value })}
                      />
                    </FormField>
                  </>
                )}
                <FormField label="Time zone" htmlFor="calendar-editor-time-zone">
                  <TextField
                    id="calendar-editor-time-zone"
                    value={editor.timeZone}
                    onChange={(event) => setEditor({ ...editor, timeZone: event.currentTarget.value })}
                  />
                </FormField>
              </div>

              {editor.editScope === "series" && (
                <Surface padding="compact">
                  <strong>Repeat</strong>
                  <div className="homi-calendar-form-grid" style={{ marginTop: 10 }}>
                    <FormField label="Frequency" htmlFor="calendar-editor-repeat">
                      <Select
                        id="calendar-editor-repeat"
                        value={editor.recurrenceFrequency}
                        onChange={(event) =>
                          setEditor({
                            ...editor,
                            recurrenceFrequency: event.currentTarget.value as CalendarEditorState["recurrenceFrequency"],
                          })
                        }
                      >
                        <option value="none">Does not repeat</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                      </Select>
                    </FormField>
                    {editor.recurrenceFrequency !== "none" && (
                      <>
                        <FormField label="Every" htmlFor="calendar-editor-interval">
                          <TextField
                            id="calendar-editor-interval"
                            type="number"
                            min={1}
                            max={99}
                            value={editor.recurrenceInterval}
                            onChange={(event) => setEditor({ ...editor, recurrenceInterval: event.currentTarget.value })}
                          />
                        </FormField>
                        <FormField label="Ends on" htmlFor="calendar-editor-repeat-end">
                          <TextField
                            id="calendar-editor-repeat-end"
                            type="date"
                            value={editor.recurrenceEndDate}
                            onChange={(event) => setEditor({ ...editor, recurrenceEndDate: event.currentTarget.value })}
                          />
                        </FormField>
                      </>
                    )}
                  </div>
                  {editor.recurrenceFrequency === "weekly" && (
                    <div className="homi-calendar-checkboxes" style={{ marginTop: 10 }}>
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, day) => (
                        <label key={label}>
                          <input
                            type="checkbox"
                            checked={editor.recurrenceWeekdays.includes(day)}
                            onChange={() =>
                              setEditor({
                                ...editor,
                                recurrenceWeekdays: editor.recurrenceWeekdays.includes(day)
                                  ? editor.recurrenceWeekdays.filter((value) => value !== day)
                                  : [...editor.recurrenceWeekdays, day],
                              })
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  )}
                </Surface>
              )}

              {editor.kind === "edit" &&
                editor.seriesEvent?.recurrence && (
                <Surface padding="compact">
                  <strong>Chequebook</strong>
                  {!chequebookOpen ? (
                    <div style={{ marginTop: 10 }}>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void openChequebookLink()}
                      >
                        Add recurring entry to Chequebook
                      </Button>
                    </div>
                  ) : (
                    <div className="homi-calendar-form-grid" style={{ marginTop: 10 }}>
                      <FormField label="Account" htmlFor="calendar-chequebook-account">
                        <Select
                          id="calendar-chequebook-account"
                          value={chequebookAccountId}
                          onChange={(event) =>
                            setChequebookAccountId(event.currentTarget.value)
                          }
                        >
                          {(chequebookOptions?.accounts ?? []).map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <FormField label="Type" htmlFor="calendar-chequebook-kind">
                        <Select
                          id="calendar-chequebook-kind"
                          value={chequebookKind}
                          onChange={(event) => {
                            const kind = event.currentTarget.value as "expense" | "income";
                            setChequebookKind(kind);
                            const category = chequebookOptions?.categories.find(
                              (item) => item.kind === kind || item.kind === "both",
                            );
                            setChequebookCategoryId(category?.id ?? "");
                          }}
                        >
                          <option value="expense">Expense</option>
                          <option value="income">Income</option>
                        </Select>
                      </FormField>
                      <FormField label="Category" htmlFor="calendar-chequebook-category">
                        <Select
                          id="calendar-chequebook-category"
                          value={chequebookCategoryId}
                          onChange={(event) =>
                            setChequebookCategoryId(event.currentTarget.value)
                          }
                        >
                          <option value="">No category</option>
                          {(chequebookOptions?.categories ?? [])
                            .filter(
                              (category) =>
                                category.kind === chequebookKind ||
                                category.kind === "both",
                            )
                            .map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.name}
                              </option>
                            ))}
                        </Select>
                      </FormField>
                      <FormField label="Amount" htmlFor="calendar-chequebook-amount">
                        <TextField
                          id="calendar-chequebook-amount"
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={chequebookAmount}
                          onChange={(event) =>
                            setChequebookAmount(event.currentTarget.value)
                          }
                        />
                      </FormField>
                      <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
                        <Button
                          type="button"
                          variant="quiet"
                          onClick={() => setChequebookOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          disabled={busy || !chequebookAccountId || !chequebookAmount}
                          onClick={() => void linkEditorToChequebook()}
                        >
                          Add to Chequebook
                        </Button>
                      </div>
                    </div>
                  )}
                </Surface>
              )}

              {people.length > 0 && (
                <Surface padding="compact">
                  <strong>People</strong>
                  <div className="homi-calendar-checkboxes" style={{ marginTop: 10 }}>
                    {people.map((person) => (
                      <label key={person.id}>
                        <input
                          type="checkbox"
                          checked={editor.personIds.includes(person.id)}
                          onChange={() =>
                            setEditor({
                              ...editor,
                              personIds: editor.personIds.includes(person.id)
                                ? editor.personIds.filter((id) => id !== person.id)
                                : [...editor.personIds, person.id],
                            })
                          }
                        />
                        {person.displayName}
                      </label>
                    ))}
                  </div>
                </Surface>
              )}

              <Surface padding="compact">
                <strong>Reminders</strong>
                <div className="homi-calendar-checkboxes" style={{ marginTop: 10 }}>
                  {[
                    { minutes: 30, label: "30 minutes before" },
                    { minutes: 60, label: "1 hour before" },
                  ].map((choice) => (
                    <label key={choice.minutes}>
                      <input
                        type="checkbox"
                        checked={editor.reminderMinutes.includes(choice.minutes)}
                        onChange={() =>
                          setEditor({
                            ...editor,
                            reminderMinutes: editor.reminderMinutes.includes(choice.minutes)
                              ? editor.reminderMinutes.filter((value) => value !== choice.minutes)
                              : [...editor.reminderMinutes, choice.minutes],
                          })
                        }
                      />
                      {choice.label}
                    </label>
                  ))}
                </div>
              </Surface>

              <Surface padding="compact">
                <strong>Transportation</strong>
                <div className="homi-calendar-form-grid" style={{ marginTop: 10 }}>
                  <FormField label="Plan" htmlFor="calendar-editor-transport">
                    <Select
                      id="calendar-editor-transport"
                      value={editor.transportMode}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          transportMode: event.currentTarget.value as CalendarTransportMode,
                        })
                      }
                    >
                      <option value="none">None</option>
                      <option value="self">Self / no coordination</option>
                      <option value="pickup">Pickup</option>
                      <option value="dropoff">Drop-off</option>
                      <option value="round-trip">Pickup and drop-off</option>
                    </Select>
                  </FormField>
                  {(editor.transportMode === "pickup" || editor.transportMode === "round-trip") && (
                    <FormField label="Pickup by" htmlFor="calendar-editor-pickup">
                      <Select
                        id="calendar-editor-pickup"
                        value={editor.pickupPersonId}
                        onChange={(event) => setEditor({ ...editor, pickupPersonId: event.currentTarget.value })}
                      >
                        <option value="">Choose person</option>
                        {people.map((person) => (
                          <option key={person.id} value={person.id}>{person.displayName}</option>
                        ))}
                      </Select>
                    </FormField>
                  )}
                  {(editor.transportMode === "dropoff" || editor.transportMode === "round-trip") && (
                    <FormField label="Drop-off by" htmlFor="calendar-editor-dropoff">
                      <Select
                        id="calendar-editor-dropoff"
                        value={editor.dropoffPersonId}
                        onChange={(event) => setEditor({ ...editor, dropoffPersonId: event.currentTarget.value })}
                      >
                        <option value="">Choose person</option>
                        {people.map((person) => (
                          <option key={person.id} value={person.id}>{person.displayName}</option>
                        ))}
                      </Select>
                    </FormField>
                  )}
                  {editor.transportMode !== "none" && (
                    <FormField label="Transportation notes" htmlFor="calendar-editor-transport-notes">
                      <TextField
                        id="calendar-editor-transport-notes"
                        value={editor.transportNotes}
                        onChange={(event) => setEditor({ ...editor, transportNotes: event.currentTarget.value })}
                      />
                    </FormField>
                  )}
                </div>
              </Surface>

              <FormField label="Notes" htmlFor="calendar-editor-notes">
                <TextField
                  id="calendar-editor-notes"
                  value={editor.notes}
                  onChange={(event) => setEditor({ ...editor, notes: event.currentTarget.value })}
                />
              </FormField>

              <div className="homi-calendar-editor-actions">
                <div>
                  {editor.kind === "edit" && (
                    <Button
                      type="button"
                      variant="quiet"
                      disabled={busy}
                      onClick={() => void deleteEditorEvent()}
                    >
                      {editor.editScope === "occurrence" && editor.seriesEvent?.recurrence
                        ? "Skip occurrence"
                        : "Delete event"}
                    </Button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={busy}
                    onClick={() => setEditor(null)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={busy}>
                    {busy ? "Saving…" : "Save event"}
                  </Button>
                </div>
              </div>
            </form>
          </Surface>
        </div>
      )}
    </section>
  );
}

function ExternalCalendarSettings({
  context,
}: Pick<HomiWebModuleSurfaceProps, "context">) {
  const [providers, setProviders] = useState<
    readonly CalendarExternalProviderStatus[]
  >([]);
  const [connections, setConnections] = useState<
    readonly CalendarExternalConnectionSnapshot[]
  >([]);
  const [feeds, setFeeds] = useState<readonly CalendarIcsFeedSnapshot[]>([]);
  const [appleUsername, setAppleUsername] = useState("");
  const [applePassword, setApplePassword] = useState("");
  const [appleCalendars, setAppleCalendars] = useState<
    readonly CalendarAppleDiscovery[]
  >([]);
  const [appleCalendarUrl, setAppleCalendarUrl] = useState("");
  const [feedLabel, setFeedLabel] = useState("Family Calendar");
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!context.online) return;
    const [nextProviders, nextConnections, nextFeeds] = await Promise.all([
      loadExternalProviders(context),
      loadExternalConnections(context),
      loadIcsFeeds(context),
    ]);
    setProviders(nextProviders);
    setConnections(nextConnections);
    setFeeds(nextFeeds);
  }, [context.householdId, context.clientId, context.online]);

  useEffect(() => {
    void refresh().catch((error: unknown) =>
      setMessage(
        error instanceof Error
          ? error.message
          : "External Calendar settings could not be loaded.",
      ),
    );
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("calendarProviderConnected");
    const providerError = params.get("calendarProviderError");
    if (connected) setMessage(`${connected} Calendar connected.`);
    if (providerError) setMessage(providerError);
  }, [refresh]);

  async function connectOAuth(
    provider: "google" | "outlook",
  ): Promise<void> {
    if (busy || !context.online) return;
    setBusy(true);
    try {
      const url = await beginProviderOAuth(context, provider);
      window.location.assign(url);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Calendar provider connection could not start.",
      );
      setBusy(false);
    }
  }

  async function discoverApple(): Promise<void> {
    if (busy || !context.online) return;
    setBusy(true);
    try {
      const discovered = await discoverAppleCalendar(
        context,
        appleUsername.trim(),
        applePassword,
      );
      setAppleCalendars(discovered);
      setAppleCalendarUrl(discovered[0]?.href ?? "");
      setMessage(
        discovered.length > 0
          ? "Choose the Apple calendar to add."
          : "No Apple calendars were returned for this account.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Apple calendars could not be discovered.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function connectApple(): Promise<void> {
    const selected = appleCalendars.find(
      (calendar) => calendar.href === appleCalendarUrl,
    );
    if (!selected || busy || !context.online) return;
    setBusy(true);
    try {
      await connectAppleCalendar(context, {
        username: appleUsername.trim(),
        password: applePassword,
        calendarUrl: selected.href,
        label: selected.displayName,
      });
      setApplePassword("");
      setAppleCalendars([]);
      setAppleCalendarUrl("");
      await refresh();
      setMessage("Apple Calendar connected.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Apple Calendar could not be connected.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(connectionId: string): Promise<void> {
    if (busy || !context.online) return;
    setBusy(true);
    try {
      await disconnectExternalCalendar(context, connectionId);
      await refresh();
      setMessage("External Calendar disconnected.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "External Calendar could not be disconnected.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function makeFeed(): Promise<void> {
    if (!feedLabel.trim() || busy || !context.online) return;
    setBusy(true);
    try {
      const url = await createIcsFeed(context, feedLabel.trim());
      setFeedUrl(url);
      await refresh();
      setMessage(
        "Private Calendar feed created. Copy the URL now; Homi stores only its token hash.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Private Calendar feed could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function regenerateFeed(feedId: string): Promise<void> {
    if (busy || !context.online) return;
    setBusy(true);
    try {
      const url = await regenerateIcsFeed(context, feedId);
      setFeedUrl(url);
      await refresh();
      setMessage(
        "Feed token regenerated. The old URL is no longer valid; copy the new URL now.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Private Calendar feed could not be regenerated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revokeFeed(feedId: string): Promise<void> {
    if (busy || !context.online) return;
    setBusy(true);
    try {
      await revokeIcsFeed(context, feedId);
      setFeedUrl(null);
      await refresh();
      setMessage("Private Calendar feed revoked.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Private Calendar feed could not be revoked.",
      );
    } finally {
      setBusy(false);
    }
  }

  const google = providers.find((item) => item.provider === "google");
  const outlook = providers.find((item) => item.provider === "outlook");

  return (
    <div style={stackStyle}>
      <Surface padding="compact">
        <strong>External calendars</strong>
        <p style={{ color: "var(--homi-text-muted)" }}>
          External calendars are synchronized into Homi as read-only colored layers. Homi-created calendars remain authoritative in Homi.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Button
            variant="quiet"
            disabled={!context.online || busy || !google?.configured}
            onClick={() => void connectOAuth("google")}
          >
            Connect Google Calendar
          </Button>
          <Button
            variant="quiet"
            disabled={!context.online || busy || !outlook?.configured}
            onClick={() => void connectOAuth("outlook")}
          >
            Connect Outlook Calendar
          </Button>
        </div>
        {google && !google.configured && (
          <small style={{ color: "var(--homi-text-muted)" }}>
            Google OAuth client credentials must be configured on the Homi server before connection.
          </small>
        )}
        {outlook && !outlook.configured && (
          <small style={{ color: "var(--homi-text-muted)" }}>
            Microsoft OAuth client credentials must be configured on the Homi server before connection.
          </small>
        )}
      </Surface>

      <Surface padding="compact">
        <strong>Apple Calendar</strong>
        <p style={{ color: "var(--homi-text-muted)" }}>
          Use the Apple account address and an app-specific password. Credentials are stored in Homi's encrypted module-secret vault.
        </p>
        <div className="homi-calendar-form-grid">
          <FormField label="Apple account" htmlFor="calendar-apple-user">
            <TextField
              id="calendar-apple-user"
              value={appleUsername}
              onChange={(event) => setAppleUsername(event.currentTarget.value)}
              disabled={!context.online || busy}
            />
          </FormField>
          <FormField label="App-specific password" htmlFor="calendar-apple-password">
            <TextField
              id="calendar-apple-password"
              type="password"
              value={applePassword}
              onChange={(event) => setApplePassword(event.currentTarget.value)}
              disabled={!context.online || busy}
            />
          </FormField>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          <Button
            variant="quiet"
            disabled={
              !context.online || busy ||
              !appleUsername.trim() || !applePassword
            }
            onClick={() => void discoverApple()}
          >
            Find Apple calendars
          </Button>
          {appleCalendars.length > 0 && (
            <>
              <Select
                aria-label="Apple calendar"
                value={appleCalendarUrl}
                onChange={(event) => setAppleCalendarUrl(event.currentTarget.value)}
              >
                {appleCalendars.map((calendar) => (
                  <option key={calendar.href} value={calendar.href}>
                    {calendar.displayName}
                  </option>
                ))}
              </Select>
              <Button
                disabled={!appleCalendarUrl || busy}
                onClick={() => void connectApple()}
              >
                Add Apple calendar
              </Button>
            </>
          )}
        </div>
      </Surface>

      {connections.length > 0 && (
        <Surface padding="compact">
          <strong>Connected calendars</strong>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {connections.map((connection) => (
              <div
                key={connection.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) auto",
                  gap: 10,
                  alignItems: "center",
                  borderBottom: "1px solid var(--homi-border)",
                  paddingBottom: 10,
                }}
              >
                <div style={{ display: "grid", gap: 3 }}>
                  <strong>{connection.accountLabel}</strong>
                  <small style={{ color: "var(--homi-text-muted)" }}>
                    {connection.provider} · {connection.status}
                    {connection.lastSyncedAt
                      ? ` · synced ${new Date(connection.lastSyncedAt).toLocaleString()}`
                      : " · not synced yet"}
                  </small>
                  {connection.lastError && (
                    <small>{connection.lastError}</small>
                  )}
                </div>
                <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                  <small style={{ color: "var(--homi-text-muted)" }}>
                    Automatic sync · about every 15 minutes
                  </small>
                  <Button
                    variant="quiet"
                    disabled={!context.online || busy || connection.status === "disabled"}
                    onClick={() => void disconnect(connection.id)}
                  >
                    Disconnect
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Surface>
      )}

      <Surface padding="compact">
        <strong>Private iCal / ICS feeds</strong>
        <p style={{ color: "var(--homi-text-muted)" }}>
          Use a private feed URL to subscribe to the Homi household calendar from another calendar application. Regenerating a feed immediately invalidates its old URL.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <TextField
            value={feedLabel}
            onChange={(event) => setFeedLabel(event.currentTarget.value)}
            disabled={!context.online || busy}
            placeholder="Feed name"
          />
          <Button
            variant="quiet"
            disabled={!context.online || busy || !feedLabel.trim()}
            onClick={() => void makeFeed()}
          >
            Create private feed
          </Button>
        </div>
        {feedUrl && (
          <Notice title="Private feed URL">
            <span style={{ overflowWrap: "anywhere" }}>{feedUrl}</span>
          </Notice>
        )}
        {feeds.length > 0 && (
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {feeds.map((feed) => (
              <div
                key={feed.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) auto",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <span>
                  {feed.label} · {feed.active ? "active" : "revoked"}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <Button
                    variant="quiet"
                    disabled={!context.online || busy}
                    onClick={() => void regenerateFeed(feed.id)}
                  >
                    Regenerate
                  </Button>
                  {feed.active && (
                    <Button
                      variant="quiet"
                      disabled={!context.online || busy}
                      onClick={() => void revokeFeed(feed.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Surface>

      {message && <Notice>{message}</Notice>}
    </div>
  );
}

function CalendarSetup({
  context,
  actions,
}: HomiWebModuleSurfaceProps) {
  const [defaultView, setDefaultView] = useState("week");
  const [weekStart, setWeekStart] = useState("sunday");
  const [timeZone, setTimeZone] = useState(context.timeZone);
  const [defaultReminder, setDefaultReminder] = useState("30m");
  const [defaultCalendarId, setDefaultCalendarId] = useState("");
  const [settingsRevision, setSettingsRevision] = useState("0");
  const [calendars, setCalendars] = useState<readonly CalendarLayerSnapshot[]>([]);
  const [setupColor, setSetupColor] = useState<CalendarColor>("blue");
  const [newLayerName, setNewLayerName] = useState("");
  const [newLayerColor, setNewLayerColor] = useState<CalendarColor>("green");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const metadata = await loadCalendarMetadata(context, actions);
    const settings = metadata.settings;
    const layers = metadata.calendars;
    if (!settings) return;
    setDefaultView(settings.defaultView);
    setWeekStart(settings.weekStart);
    setTimeZone(settings.timeZone);
    setDefaultReminder(settings.defaultReminder);
    setDefaultCalendarId(settings.defaultCalendarId);
    setSettingsRevision(settings.revision);
    setCalendars(layers);
    const defaultLayer = layers.find(
      (layer) => layer.id === settings.defaultCalendarId,
    );
    if (defaultLayer) setSetupColor(defaultLayer.color);
  }, [actions, context.householdId, context.online]);

  useEffect(() => {
    void refresh().catch((error: unknown) =>
      setMessage(
        error instanceof Error
          ? error.message
          : "Calendar setup could not be loaded.",
      ),
    );
  }, [refresh]);

  async function addLayer(): Promise<void> {
    const name = newLayerName.trim();
    if (!name || !context.online || busy) return;
    setBusy(true);
    try {
      const entityId = crypto.randomUUID();
      await actions.enqueueMutation({
        entityType: "calendar-layer",
        entityId,
        operation: "create",
        baseRevision: "0",
        payload: { name, color: newLayerColor },
      });
      await actions.syncNow();
      setNewLayerName("");
      await refresh();
      if (!defaultCalendarId) {
        setDefaultCalendarId(entityId);
        setSetupColor(newLayerColor);
      }
      setMessage("Calendar added.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Calendar could not be added.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    if (!context.online) {
      setMessage("Reconnect to complete Calendar setup.");
      return;
    }
    const selected = calendars.find(
      (layer) => layer.id === defaultCalendarId,
    );
    if (!selected) {
      setMessage("Choose a default calendar.");
      return;
    }
    setBusy(true);
    try {
      if (selected.color !== setupColor) {
        await actions.enqueueMutation({
          entityType: "calendar-layer",
          entityId: selected.id,
          operation: "update",
          baseRevision: selected.revision,
          payload: { name: selected.name, color: setupColor },
        });
      }
      await actions.enqueueMutation({
        entityType: "calendar-settings",
        entityId: context.householdId,
        operation: "update",
        baseRevision: settingsRevision,
        payload: {
          defaultView,
          weekStart,
          timeZone,
          defaultReminder,
          defaultCalendarId,
        },
      });
      await actions.syncNow();
      setMessage("Calendar is ready.");
      await actions.refreshModuleState();
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Calendar setup could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SetupLayout
      title="Set up Calendar"
      description="Choose your household Calendar defaults, layers, color, reminders and time behavior."
      actions={
        <Button
          disabled={busy || !context.online || !defaultCalendarId}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save Calendar"}
        </Button>
      }
    >
      <div style={{ ...stackStyle, maxWidth: 760 }}>
        <div className="homi-calendar-form-grid">
          <FormField label="Default view" htmlFor="calendar-default-view">
            <Select
              id="calendar-default-view"
              value={defaultView}
              onChange={(event) => setDefaultView(event.currentTarget.value)}
              disabled={!context.online || busy}
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="upcoming">Upcoming</option>
            </Select>
          </FormField>
          <FormField label="Week starts" htmlFor="calendar-week-start">
            <Select
              id="calendar-week-start"
              value={weekStart}
              onChange={(event) => setWeekStart(event.currentTarget.value)}
              disabled={!context.online || busy}
            >
              <option value="sunday">Sunday</option>
              <option value="monday">Monday</option>
            </Select>
          </FormField>
          <FormField label="Time zone" htmlFor="calendar-time-zone">
            <TextField
              id="calendar-time-zone"
              value={timeZone}
              onChange={(event) => setTimeZone(event.currentTarget.value)}
              disabled={!context.online || busy}
            />
          </FormField>
          <FormField label="Default reminder" htmlFor="calendar-default-reminder">
            <Select
              id="calendar-default-reminder"
              value={defaultReminder}
              onChange={(event) => setDefaultReminder(event.currentTarget.value)}
              disabled={!context.online || busy}
            >
              <option value="none">None</option>
              <option value="30m">30 minutes before</option>
              <option value="1h">1 hour before</option>
            </Select>
          </FormField>
          <FormField label="Default calendar" htmlFor="calendar-default-layer">
            <Select
              id="calendar-default-layer"
              value={defaultCalendarId}
              onChange={(event) => {
                const id = event.currentTarget.value;
                setDefaultCalendarId(id);
                const layer = calendars.find((item) => item.id === id);
                if (layer) setSetupColor(layer.color);
              }}
              disabled={!context.online || busy}
            >
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Default calendar color" htmlFor="calendar-default-color">
            <Select
              id="calendar-default-color"
              value={setupColor}
              onChange={(event) =>
                setSetupColor(event.currentTarget.value as CalendarColor)
              }
              disabled={!context.online || busy}
            >
              {Object.keys(CALENDAR_COLORS).map((color) => (
                <option key={color} value={color}>{color}</option>
              ))}
            </Select>
          </FormField>
        </div>

        <Surface padding="compact">
          <strong>Calendar layers</strong>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {calendars.map((calendar) => (
              <div
                key={calendar.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "12px minmax(0,1fr)",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: CALENDAR_COLORS[calendar.color],
                  }}
                />
                <span>{calendar.name}</span>
              </div>
            ))}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) minmax(140px,180px) auto",
              gap: 8,
              marginTop: 14,
            }}
          >
            <TextField
              value={newLayerName}
              placeholder="Add another calendar"
              onChange={(event) => setNewLayerName(event.currentTarget.value)}
              disabled={!context.online || busy}
            />
            <Select
              value={newLayerColor}
              onChange={(event) =>
                setNewLayerColor(event.currentTarget.value as CalendarColor)
              }
              disabled={!context.online || busy}
            >
              {Object.keys(CALENDAR_COLORS).map((color) => (
                <option key={color} value={color}>{color}</option>
              ))}
            </Select>
            <Button
              variant="quiet"
              disabled={!context.online || busy || !newLayerName.trim()}
              onClick={() => void addLayer()}
            >
              Add
            </Button>
          </div>
        </Surface>

        <ExternalCalendarSettings context={context} />

        {message && <Notice>{message}</Notice>}
      </div>
    </SetupLayout>
  );
}

function CalendarSettings(props: HomiWebModuleSurfaceProps) {
  return (
    <section style={stackStyle}>
      <ModuleHeader
        eyebrow="Calendar"
        title="Calendar settings"
        description="Household Calendar preferences stay with the module."
      />
      <CalendarSetup {...props} />
    </section>
  );
}

function useSummary(
  context: HomiWebModuleHostContext,
  actions: HomiWebModuleSurfaceProps["actions"],
) {
  const { events } = useCalendarEvents(context, actions);
  const today = dateKey(new Date(), context.timeZone);
  return {
    today,
    todayEvents: expandCalendarEvents(
      events,
      today,
      addDays(today, 1),
    ),
    weekEvents: expandCalendarEvents(
      events,
      today,
      addDays(today, 7),
    ),
    events,
  };
}

function TodayCountCard({
  context,
  actions,
}: HomiWebModuleSurfaceProps) {
  const { todayEvents } = useSummary(context, actions);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <strong style={{ fontSize: "2.1rem" }}>
        {todayEvents.length}
      </strong>
      <span>
        {todayEvents.length === 1 ? "event today" : "events today"}
      </span>
      {todayEvents[0] && (
        <small style={{ color: "var(--board-muted)" }}>
          Next: {todayEvents[0].event.title}
        </small>
      )}
    </div>
  );
}

function ComingWeekCard({
  context,
  actions,
}: HomiWebModuleSurfaceProps) {
  const { weekEvents } = useSummary(context, actions);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {weekEvents.length === 0 ? (
        <span>No events in the next seven days.</span>
      ) : (
        weekEvents.slice(0, 4).map((item) => (
          <div
            key={item.occurrenceId}
            style={{
              display: "grid",
              gridTemplateColumns: "72px minmax(0, 1fr)",
              gap: 8,
            }}
          >
            <strong>{item.occurrenceDate.slice(5)}</strong>
            <span>{item.event.title}</span>
          </div>
        ))
      )}
      {weekEvents.length > 4 && (
        <small>+{weekEvents.length - 4} more</small>
      )}
    </div>
  );
}

function MiniMonthCard({
  context,
  actions,
}: HomiWebModuleSurfaceProps) {
  const { events, today } = useSummary(context, actions);
  const start = monthStart(today);
  const end = nextMonth(start);
  const occurrences = expandCalendarEvents(events, start, end);
  const first = new Date(`${start}T12:00:00Z`).getUTCDay();
  const days = new Date(
    Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0),
  ).getUTCDate();
  const counts = new Map<string, number>();
  for (const item of occurrences) {
    counts.set(
      item.occurrenceDate,
      (counts.get(item.occurrenceDate) ?? 0) + 1,
    );
  }
  return (
    <div style={{ ...gridStyle, gap: 3 }}>
      {Array.from({ length: first }).map((_, index) => (
        <span key={`blank-${index}`} />
      ))}
      {Array.from({ length: days }).map((_, index) => {
        const day = index + 1;
        const key = `${start.slice(0, 8)}${String(day).padStart(2, "0")}`;
        const count = counts.get(key) ?? 0;
        return (
          <span
            key={key}
            style={{
              minHeight: 28,
              display: "grid",
              placeItems: "center",
              borderRadius: 8,
              fontSize: "0.72rem",
              fontWeight: key === today ? 900 : 700,
              background:
                count > 0
                  ? "var(--homi-primary-soft)"
                  : "transparent",
            }}
          >
            {day}
          </span>
        );
      })}
    </div>
  );
}

export function createHomiWebModule(
  _context: HomiWebModuleHostContext,
) {
  return defineHomiWebModule({
    moduleKey: CALENDAR_MODULE_KEY,
    moduleApiVersion: HOMI_MODULE_API_VERSION,
    pages: {
      calendar: CalendarPage,
    },
    setup: CalendarSetup,
    settings: {
      household: CalendarSettings,
    },
    familyBoard: {
      "today-count": TodayCountCard,
      "coming-week": ComingWeekCard,
      "mini-month": MiniMonthCard,
    },
    sync: {
      mutationAdapters: [
        calendarEventMutationAdapter,
        calendarLayerMutationAdapter,
        calendarSettingsMutationAdapter,
        legacyCalendarLayerMutationAdapter,
        legacyCalendarSettingsMutationAdapter,
      ],
      changeHandlers: [
        calendarEventChangeHandler,
        calendarLayerChangeHandler,
        calendarSettingsChangeHandler,
        legacyCalendarLayerChangeHandler,
        legacyCalendarSettingsChangeHandler,
      ],
    },
  });
}
