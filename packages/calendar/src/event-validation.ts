import type {
  CalendarEventPayload,
  CalendarOccurrenceOverride,
  CalendarOccurrenceReplacement,
  CalendarRecurrenceRule,
  CalendarTransportContext,
} from "./types.js";
import { CALENDAR_COLORS, validTimeZone } from "./settings.js";

export const calendarUuid = (value: unknown): value is string =>
  typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const calendarDate = (value: unknown): value is string =>
  typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString().slice(0, 10) === value;

export const calendarInstant = (value: unknown): value is string =>
  typeof value === "string"
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function optionalText(value: unknown, max: number): value is string | null {
  return value === null || (typeof value === "string" && value.trim().length <= max);
}

function uuidList(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.length <= 64
    && value.every(calendarUuid)
    && new Set(value.map((item) => item.toLowerCase())).size === value.length;
}

export function validReminderMinutes(value: unknown): value is readonly number[] {
  return Array.isArray(value)
    && value.length <= 8
    && value.every((item) => Number.isSafeInteger(item) && item > 0 && item <= 10_080)
    && new Set(value).size === value.length;
}

export function validTransportContext(value: unknown): value is CalendarTransportContext {
  if (!object(value) || !exactKeys(value, ["mode", "pickupPersonId", "dropoffPersonId", "notes"])) return false;
  if (!["none", "self", "pickup", "dropoff", "round-trip"].includes(String(value.mode))) return false;
  if (value.pickupPersonId !== null && !calendarUuid(value.pickupPersonId)) return false;
  if (value.dropoffPersonId !== null && !calendarUuid(value.dropoffPersonId)) return false;
  if (!optionalText(value.notes, 1000)) return false;
  if (value.mode === "none" || value.mode === "self") {
    return value.pickupPersonId === null && value.dropoffPersonId === null;
  }
  if (value.mode === "pickup") return value.pickupPersonId !== null && value.dropoffPersonId === null;
  if (value.mode === "dropoff") return value.pickupPersonId === null && value.dropoffPersonId !== null;
  return value.pickupPersonId !== null && value.dropoffPersonId !== null;
}

export function validRecurrenceRule(value: unknown): value is CalendarRecurrenceRule {
  if (!object(value) || !exactKeys(value, ["frequency", "interval", "weekdays", "endDate"])) return false;
  if (!["daily", "weekly", "monthly", "yearly"].includes(String(value.frequency))) return false;
  if (!Number.isSafeInteger(value.interval) || Number(value.interval) < 1 || Number(value.interval) > 99) return false;
  if (!Array.isArray(value.weekdays)
    || value.weekdays.some((day) => !Number.isSafeInteger(day) || Number(day) < 0 || Number(day) > 6)
    || new Set(value.weekdays).size !== value.weekdays.length) return false;
  if (value.frequency === "weekly") {
    if (value.weekdays.length < 1) return false;
  } else if (value.weekdays.length !== 0) {
    return false;
  }
  return value.endDate === null || calendarDate(value.endDate);
}

function validReplacement(value: unknown): value is CalendarOccurrenceReplacement {
  if (!object(value) || !exactKeys(value, [
    "calendarId", "color", "title", "description", "allDay", "timeZone",
    "startsAt", "endsAt", "startDate", "endDateExclusive",
    "location", "notes", "personIds", "reminderMinutes", "transport",
  ])) return false;
  if (!calendarUuid(value.calendarId)
    || typeof value.color !== "string"
    || !Object.hasOwn(CALENDAR_COLORS, value.color)
    || typeof value.title !== "string"
    || value.title.trim().length < 1
    || value.title.trim().length > 200
    || !optionalText(value.description, 5000)
    || typeof value.allDay !== "boolean"
    || !validTimeZone(value.timeZone)
    || !optionalText(value.location, 240)
    || !optionalText(value.notes, 5000)
    || !uuidList(value.personIds)
    || !validReminderMinutes(value.reminderMinutes)
    || !validTransportContext(value.transport)) return false;
  return validEventTime(value as CalendarEventPayload);
}

export function validRecurrenceOverrides(value: unknown): value is readonly CalendarOccurrenceOverride[] {
  if (!Array.isArray(value) || value.length > 512) return false;
  const dates = new Set<string>();
  for (const item of value) {
    if (!object(item) || !exactKeys(item, ["occurrenceDate", "action", "replacement"])) return false;
    if (!calendarDate(item.occurrenceDate) || dates.has(item.occurrenceDate)) return false;
    dates.add(item.occurrenceDate);
    if (item.action === "skip") {
      if (item.replacement !== null) return false;
    } else if (item.action === "replace") {
      if (!validReplacement(item.replacement)) return false;
    } else {
      return false;
    }
  }
  return true;
}

export function validEventTime(value: CalendarEventPayload): boolean {
  return validTimeZone(value.timeZone) && (
    value.allDay === true
      ? calendarDate(value.startDate)
        && calendarDate(value.endDateExclusive)
        && value.endDateExclusive > value.startDate
        && value.startsAt === null
        && value.endsAt === null
      : value.allDay === false
        && calendarInstant(value.startsAt)
        && calendarInstant(value.endsAt)
        && value.endsAt > value.startsAt
        && value.startDate === null
        && value.endDateExclusive === null
  );
}

/** Exact compatibility shape emitted by the deployed 5.3 browser queue. */
export function isLegacyV53EventPayload(value: CalendarEventPayload): boolean {
  if (
    value.calendarId !== undefined
    || value.timeZone !== undefined
    || value.startDate !== undefined
    || value.endDateExclusive !== undefined
    || value.description !== undefined
    || value.recurrence !== undefined
    || value.recurrenceOverrides !== undefined
    || value.personIds !== undefined
    || value.reminderMinutes !== undefined
    || value.transport !== undefined
  ) return false;
  return typeof value.title === "string"
    && value.title.length >= 1
    && value.title.length <= 200
    && calendarInstant(value.startsAt)
    && calendarInstant(value.endsAt)
    && value.endsAt > value.startsAt
    && typeof value.allDay === "boolean";
}

export function parseEventPayload(
  value: unknown,
  operation: "create" | "update" | "delete",
): CalendarEventPayload {
  const fail = (): never => {
    throw new Error("Invalid Calendar event payload.");
  };
  if (!object(value)) return fail();
  const source = value;
  const keys = [
    "title", "description", "calendarId", "color", "timeZone", "startsAt", "endsAt", "allDay",
    "startDate", "endDateExclusive", "location", "notes", "recurrence",
    "recurrenceOverrides", "personIds", "reminderMinutes", "transport",
  ];
  if (Object.keys(source).some((key) => !keys.includes(key))) return fail();
  if (operation === "delete") {
    if (Object.keys(source).length) return fail();
    return {};
  }

  const output: CalendarEventPayload = {};
  if (source.title !== undefined) {
    if (typeof source.title !== "string" || !source.title.trim() || source.title.trim().length > 200) return fail();
    output.title = source.title.trim();
  }
  for (const [key, max] of [["description", 5000], ["location", 240], ["notes", 5000]] as const) {
    if (source[key] === undefined) continue;
    if (!optionalText(source[key], max)) return fail();
    output[key] = typeof source[key] === "string" ? source[key].trim() || null : null;
  }
  if (source.calendarId !== undefined) {
    if (!calendarUuid(source.calendarId)) return fail();
    output.calendarId = source.calendarId;
  }
  if (source.color !== undefined) {
    if (typeof source.color !== "string" || !Object.hasOwn(CALENDAR_COLORS, source.color)) return fail();
    output.color = source.color as keyof typeof CALENDAR_COLORS;
  }
  if (source.timeZone !== undefined) {
    if (!validTimeZone(source.timeZone)) return fail();
    output.timeZone = source.timeZone;
  }
  if (source.allDay !== undefined) {
    if (typeof source.allDay !== "boolean") return fail();
    output.allDay = source.allDay;
  }
  for (const key of ["startsAt", "endsAt", "startDate", "endDateExclusive"] as const) {
    if (source[key] === undefined) continue;
    const field = source[key];
    if (field !== null && !(key === "startsAt" || key === "endsAt" ? calendarInstant(field) : calendarDate(field))) return fail();
    output[key] = field as string | null;
  }
  if (source.recurrence !== undefined) {
    if (source.recurrence !== null && !validRecurrenceRule(source.recurrence)) return fail();
    output.recurrence = source.recurrence as CalendarRecurrenceRule | null;
  }
  if (source.recurrenceOverrides !== undefined) {
    if (!validRecurrenceOverrides(source.recurrenceOverrides)) return fail();
    output.recurrenceOverrides = source.recurrenceOverrides;
  }
  if (source.personIds !== undefined) {
    if (!uuidList(source.personIds)) return fail();
    output.personIds = source.personIds;
  }
  if (source.reminderMinutes !== undefined) {
    if (!validReminderMinutes(source.reminderMinutes)) return fail();
    output.reminderMinutes = source.reminderMinutes;
  }
  if (source.transport !== undefined) {
    if (!validTransportContext(source.transport)) return fail();
    output.transport = source.transport;
  }

  if (operation === "create") {
    const currentShape = output.title !== undefined && output.calendarId !== undefined && validEventTime(output);
    if (!currentShape && !isLegacyV53EventPayload(output)) return fail();
  } else if (Object.keys(output).length === 0) {
    return fail();
  }
  return output;
}
