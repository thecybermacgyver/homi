import type {
  CalendarEvent,
  CalendarOccurrence,
  CalendarOccurrenceOverride,
  CalendarOccurrenceReplacement,
  CalendarRecurrenceRule,
} from "./types.js";

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function parseDate(value: string): Date {
  const match = DATE.exec(value);
  if (!match) throw new Error("Invalid Calendar recurrence date.");
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

function dateKey(value: Date): string {
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonthsExact(anchor: Date, months: number): Date | null {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + months;
  const day = anchor.getUTCDate();
  const target = new Date(Date.UTC(year, month, day, 12));
  return target.getUTCDate() === day ? target : null;
}

function addYearsExact(anchor: Date, years: number): Date | null {
  const target = new Date(Date.UTC(
    anchor.getUTCFullYear() + years,
    anchor.getUTCMonth(),
    anchor.getUTCDate(),
    12,
  ));
  return target.getUTCMonth() === anchor.getUTCMonth()
    && target.getUTCDate() === anchor.getUTCDate()
    ? target
    : null;
}

function zonedDate(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function zonedParts(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function wallTimeToInstant(
  date: Date,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const desired = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hour,
    minute,
    second,
  );
  let guess = desired;
  for (let index = 0; index < 5; index += 1) {
    const observed = zonedParts(new Date(guess).toISOString(), timeZone);
    const observedUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const correction = desired - observedUtc;
    if (correction === 0) break;
    guess += correction;
  }
  return new Date(guess);
}

function dateDistance(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);
}

function replacementFromBase(event: CalendarEvent, occurrenceDate: string): CalendarOccurrenceReplacement {
  if (event.allDay) {
    const duration = dateDistance(event.startDate!, event.endDateExclusive!);
    return {
      calendarId: event.calendarId,
      color: event.color,
      title: event.title,
      description: event.description,
      allDay: true,
      timeZone: event.timeZone,
      startsAt: null,
      endsAt: null,
      startDate: occurrenceDate,
      endDateExclusive: dateKey(addDays(parseDate(occurrenceDate), duration)),
      location: event.location,
      notes: event.notes,
      personIds: event.personIds,
      reminderMinutes: event.reminderMinutes,
      transport: event.transport,
    };
  }

  const originalStart = zonedParts(event.startsAt!, event.timeZone);
  const originalEnd = zonedParts(event.endsAt!, event.timeZone);
  const originalStartDate = zonedDate(event.startsAt!, event.timeZone);
  const originalEndDate = zonedDate(event.endsAt!, event.timeZone);
  const endDayOffset = dateDistance(originalStartDate, originalEndDate);
  const occurrence = parseDate(occurrenceDate);
  const startsAt = wallTimeToInstant(
    occurrence,
    originalStart.hour,
    originalStart.minute,
    originalStart.second,
    event.timeZone,
  );
  const endDate = addDays(occurrence, endDayOffset);
  const endsAt = wallTimeToInstant(
    endDate,
    originalEnd.hour,
    originalEnd.minute,
    originalEnd.second,
    event.timeZone,
  );
  return {
    calendarId: event.calendarId,
    color: event.color,
    title: event.title,
    description: event.description,
    allDay: false,
    timeZone: event.timeZone,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    startDate: null,
    endDateExclusive: null,
    location: event.location,
    notes: event.notes,
    personIds: event.personIds,
    reminderMinutes: event.reminderMinutes,
    transport: event.transport,
  };
}

function anchorDate(event: CalendarEvent): string {
  return event.allDay ? event.startDate! : zonedDate(event.startsAt!, event.timeZone);
}

function datesForRule(
  anchor: string,
  rule: CalendarRecurrenceRule,
  rangeStart: string,
  rangeEndExclusive: string,
): string[] {
  const start = parseDate(anchor);
  const rangeStartDate = parseDate(rangeStart);
  const rangeEndDate = parseDate(rangeEndExclusive);
  const endInclusive = rule.endDate ? parseDate(rule.endDate) : null;
  const results: string[] = [];
  const addIfVisible = (candidate: Date | null) => {
    if (!candidate || candidate < start) return;
    if (endInclusive && candidate > endInclusive) return;
    if (candidate >= rangeStartDate && candidate < rangeEndDate) results.push(dateKey(candidate));
  };

  if (rule.frequency === "daily") {
    for (let cursor = start, guard = 0; cursor < rangeEndDate && guard < 20000; cursor = addDays(cursor, rule.interval), guard += 1) {
      addIfVisible(cursor);
      if (endInclusive && cursor > endInclusive) break;
    }
    return results;
  }

  if (rule.frequency === "weekly") {
    // DTSTART is always the stable first occurrence. BYDAY-like weekday choices
    // control subsequent occurrences and may intentionally differ from DTSTART.
    addIfVisible(start);
    const weekStart = addDays(start, -start.getUTCDay());
    for (let week = weekStart, guard = 0; week < rangeEndDate && guard < 4000; week = addDays(week, rule.interval * 7), guard += 1) {
      for (const weekday of rule.weekdays) addIfVisible(addDays(week, weekday));
      if (endInclusive && week > endInclusive) break;
    }
    return [...new Set(results)].sort();
  }

  if (rule.frequency === "monthly") {
    for (let step = 0; step < 2400; step += rule.interval) {
      const candidate = addMonthsExact(start, step);
      if (candidate && candidate >= rangeEndDate) break;
      addIfVisible(candidate);
      const probe = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + step, 1, 12));
      if (probe >= rangeEndDate || (endInclusive && probe > endInclusive)) break;
    }
    return results;
  }

  for (let step = 0; step < 400; step += rule.interval) {
    const candidate = addYearsExact(start, step);
    if (candidate && candidate >= rangeEndDate) break;
    addIfVisible(candidate);
    const probe = new Date(Date.UTC(start.getUTCFullYear() + step, 0, 1, 12));
    if (probe >= rangeEndDate || (endInclusive && probe > endInclusive)) break;
  }
  return results;
}

export function recurrenceOccursOn(
  anchorDate: string,
  rule: CalendarRecurrenceRule,
  occurrenceDate: string,
): boolean {
  const next = dateKey(addDays(parseDate(occurrenceDate), 1));
  return datesForRule(anchorDate, rule, occurrenceDate, next).includes(occurrenceDate);
}

function overrideMap(overrides: readonly CalendarOccurrenceOverride[]) {
  return new Map(overrides.map((override) => [override.occurrenceDate, override]));
}

export function expandCalendarEvent(
  event: CalendarEvent,
  rangeStartDate: string,
  rangeEndDateExclusive: string,
): readonly CalendarOccurrence[] {
  const anchor = anchorDate(event);
  const dates = event.recurrence
    ? datesForRule(anchor, event.recurrence, rangeStartDate, rangeEndDateExclusive)
    : anchor >= rangeStartDate && anchor < rangeEndDateExclusive ? [anchor] : [];
  const overrides = overrideMap(event.recurrenceOverrides);
  const occurrences: CalendarOccurrence[] = [];
  for (const occurrenceDate of dates) {
    const override = overrides.get(occurrenceDate);
    if (override?.action === "skip") continue;
    const replacement = override?.action === "replace" && override.replacement
      ? override.replacement
      : replacementFromBase(event, occurrenceDate);
    occurrences.push(Object.freeze({
      occurrenceId: `${event.id}@${occurrenceDate}`,
      seriesEventId: event.id,
      occurrenceDate,
      recurring: event.recurrence !== null,
      overridden: override !== undefined,
      event: Object.freeze({ ...replacement }),
    }));
  }
  return Object.freeze(occurrences);
}

export function expandCalendarEvents(
  events: readonly CalendarEvent[],
  rangeStartDate: string,
  rangeEndDateExclusive: string,
): readonly CalendarOccurrence[] {
  return Object.freeze(events.flatMap((event) =>
    expandCalendarEvent(event, rangeStartDate, rangeEndDateExclusive),
  ).sort((left, right) => {
    const a = left.event.allDay ? `${left.event.startDate}T00:00:00` : left.event.startsAt!;
    const b = right.event.allDay ? `${right.event.startDate}T00:00:00` : right.event.startsAt!;
    return a.localeCompare(b) || left.occurrenceId.localeCompare(right.occurrenceId);
  }));
}
