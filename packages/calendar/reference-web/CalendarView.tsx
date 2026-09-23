import { type FormEvent, useCallback, useEffect, useState } from "react";
import type {
  CalendarEvent,
  CalendarEventPayload,
  CalendarLayer,
  CalendarPerson,
  CalendarRecurrenceFrequency,
  CalendarTransportMode,
} from "@homi/calendar";
import {
  CALENDAR_COLORS,
  expandCalendarEvent,
  unconfiguredCalendarSettings,
  validTimeZone,
  type CalendarColor,
  type CalendarSettings,
  type CalendarSettingsWrite,
  type CalendarViewName,
} from "@homi/calendar/client";
import {
  createCalendarLayerOnline,
  deleteCalendarLayerOnline,
  dismissCalendarIssue,
  loadCalendarLayers,
  loadCalendarLocalView,
  loadCalendarPeople,
  loadCalendarSettings,
  queueCalendarCreate,
  queueCalendarDelete,
  queueCalendarUpdate,
  refreshCalendarLayers,
  refreshCalendarPeople,
  refreshCalendarSettings,
  saveCalendarSettingsOnline,
  updateCalendarLayerOnline,
  type CalendarDisplayEvent,
  type CalendarLocalView,
} from "./store.js";

interface CalendarViewProps {
  authSubject: string;
  householdId: string;
  clientId: string;
  timeZone: string;
  canSync: boolean;
  syncToken: string | null;
  onSync(): Promise<unknown>;
}

interface EditorState {
  kind: "create" | "edit";
  event: CalendarEvent | null;
  seriesEvent: CalendarEvent | null;
  occurrenceEvent: CalendarEvent | null;
  occurrenceDate: string | null;
  editScope: "series" | "occurrence";
  calendarId: string;
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
  startFold: "earlier" | "later" | null;
  endFold: "earlier" | "later" | null;
}

interface LayerEditDraft {
  id: string;
  name: string;
  color: CalendarColor;
  revision: string;
}

interface SettingsDraft {
  defaultView: CalendarViewName;
  weekStart: "sunday" | "monday";
  timeZone: string;
  defaultReminder: "none" | "30m" | "1h";
  defaultCalendarId: string;
}

const DAY_MS = 86_400_000;
const HOUR_HEIGHT = 48;
const GRID_HEIGHT = HOUR_HEIGHT * 24;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
  };
}

/** UTC Y/M/D is used only as a carrier for one calendar-local date. */
function calendarDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function dateFromKey(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match
    ? calendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
    : calendarDate(1970, 1, 1);
}

function calendarToday(timeZone: string): Date {
  const parts = zonedParts(new Date(), timeZone);
  return calendarDate(parts.year, parts.month, parts.day);
}

function calendarDayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function formatCalendarDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(date);
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function startOfWeek(date: Date, weekStart: "sunday" | "monday"): Date {
  const next = new Date(date);
  const target = weekStart === "monday" ? 1 : 0;
  next.setUTCDate(next.getUTCDate() - ((next.getUTCDay() - target + 7) % 7));
  return next;
}

function zonedWallTimeToInstant(day: Date, hour: number, minute: number, timeZone: string): Date {
  const desired = Date.UTC(
    day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute,
  );
  let guess = desired;
  for (let index = 0; index < 4; index += 1) {
    const observed = zonedParts(new Date(guess), timeZone);
    const observedAsUtc = Date.UTC(
      observed.year, observed.month - 1, observed.day, observed.hour, observed.minute,
    );
    const correction = desired - observedAsUtc;
    if (correction === 0) break;
    guess += correction;
  }
  return new Date(guess);
}

function calendarDayBounds(day: Date, timeZone: string): { start: Date; end: Date } {
  return {
    start: zonedWallTimeToInstant(day, 0, 0, timeZone),
    end: zonedWallTimeToInstant(addDays(day, 1), 0, 0, timeZone),
  };
}

function eventOverlapsDay(event: CalendarEvent, day: Date, timeZone: string): boolean {
  const key = calendarDayKey(day);
  if (event.allDay) {
    return event.startDate !== null && event.endDateExclusive !== null
      && event.startDate <= key && event.endDateExclusive > key;
  }
  if (!event.startsAt || !event.endsAt) return false;
  const bounds = calendarDayBounds(day, timeZone);
  return Date.parse(event.startsAt) < bounds.end.getTime()
    && Date.parse(event.endsAt) > bounds.start.getTime();
}

function clockMinutes(iso: string, timeZone: string): number {
  const parts = zonedParts(new Date(iso), timeZone);
  return parts.hour * 60 + parts.minute;
}

function eventSegment(
  event: CalendarEvent,
  day: Date,
  timeZone: string,
): { startMinute: number; endMinute: number; clippedStart: Date } | null {
  if (event.allDay || !event.startsAt || !event.endsAt) return null;
  const bounds = calendarDayBounds(day, timeZone);
  const eventStart = new Date(event.startsAt);
  const eventEnd = new Date(event.endsAt);
  const clippedStart = new Date(Math.max(eventStart.getTime(), bounds.start.getTime()));
  const clippedEnd = new Date(Math.min(eventEnd.getTime(), bounds.end.getTime()));
  if (clippedEnd <= clippedStart) return null;
  const startMinute = clippedStart <= bounds.start
    ? 0
    : clockMinutes(clippedStart.toISOString(), timeZone);
  const rawEnd = clippedEnd >= bounds.end
    ? 1440
    : clockMinutes(clippedEnd.toISOString(), timeZone);
  return { startMinute, endMinute: Math.max(startMinute + 15, rawEnd), clippedStart };
}

function zonedInputValue(iso: string, timeZone: string): string {
  const parts = zonedParts(new Date(iso), timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function inputFromUtcCarrier(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function addInputMinutes(value: string, amount: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  return inputFromUtcCarrier(new Date(Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]) + amount,
  )));
}

function localInputToInstant(value: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return new Date(Number.NaN);
  return zonedWallTimeToInstant(
    calendarDate(Number(match[1]), Number(match[2]), Number(match[3])),
    Number(match[4]), Number(match[5]), timeZone,
  );
}

function localInputCandidates(value: string, timeZone: string): Date[] {
  const first = localInputToInstant(value, timeZone);
  if (!Number.isFinite(first.getTime())) return [];
  const candidates = new Map<number, Date>();
  for (let minutes = -180; minutes <= 180; minutes += 15) {
    const candidate = new Date(first.getTime() + minutes * 60_000);
    if (zonedInputValue(candidate.toISOString(), timeZone) === value) {
      candidates.set(candidate.getTime(), candidate);
    }
  }
  return [...candidates.values()].sort((left, right) => left.getTime() - right.getTime());
}

function resolveEditorInstant(
  value: string,
  timeZone: string,
  originalIso: string | null,
  fold: "earlier" | "later" | null,
): Date {
  if (originalIso && fold === null && zonedInputValue(originalIso, timeZone) === value) {
    return new Date(originalIso);
  }
  const candidates = localInputCandidates(value, timeZone);
  if (candidates.length === 0) {
    throw new Error("That local time does not exist because the clock changes then. Choose another time.");
  }
  if (candidates.length > 1) {
    if (fold === null) {
      throw new Error("That local time occurs twice because the clock changes then. Choose the first or second occurrence.");
    }
    return fold === "earlier" ? candidates[0]! : candidates[candidates.length - 1]!;
  }
  return candidates[0]!;
}

function initialCreateEditor(
  timeZone: string,
  calendarId: string,
  base?: Date,
  defaultReminder: "none" | "30m" | "1h" = "30m",
): EditorState {
  const day = base ?? calendarToday(timeZone);
  let startsAt: string;
  if (base) {
    startsAt = `${calendarDayKey(base)}T09:00`;
  } else {
    const now = zonedParts(new Date(), timeZone);
    startsAt = inputFromUtcCarrier(
      new Date(Date.UTC(now.year, now.month - 1, now.day, now.hour + 1, 0)),
    );
  }
  return {
    kind: "create",
    event: null,
    seriesEvent: null,
    occurrenceEvent: null,
    occurrenceDate: null,
    editScope: "series",
    calendarId,
    title: "",
    description: "",
    allDay: false,
    timeZone,
    startsAt,
    endsAt: addInputMinutes(startsAt, 60),
    startDate: calendarDayKey(day),
    endDateExclusive: calendarDayKey(addDays(day, 1)),
    location: "",
    notes: "",
    recurrenceFrequency: "none",
    recurrenceInterval: "1",
    recurrenceEndDate: "",
    recurrenceWeekdays: [day.getUTCDay()],
    personIds: [],
    reminderMinutes: defaultReminder === "30m" ? [30] : defaultReminder === "1h" ? [60] : [],
    transportMode: "none",
    pickupPersonId: "",
    dropoffPersonId: "",
    transportNotes: "",
    startFold: null,
    endFold: null,
  };
}

function editEditor(
  event: CalendarEvent,
  seriesEvent: CalendarEvent = event,
  occurrenceDate: string | null = null,
  editScope: "series" | "occurrence" = occurrenceDate ? "occurrence" : "series",
): EditorState {
  const startParts = !event.allDay && event.startsAt
    ? zonedParts(new Date(event.startsAt), event.timeZone)
    : null;
  const fallbackDay = event.allDay && event.startDate
    ? dateFromKey(event.startDate)
    : startParts
      ? calendarDate(startParts.year, startParts.month, startParts.day)
      : calendarToday(event.timeZone);
  const recurrence = seriesEvent.recurrence;
  return {
    kind: "edit",
    event,
    seriesEvent,
    occurrenceEvent: occurrenceDate ? event : null,
    occurrenceDate,
    editScope,
    calendarId: event.calendarId,
    title: event.title,
    description: event.description ?? "",
    allDay: event.allDay,
    timeZone: event.timeZone,
    startsAt: event.startsAt ? zonedInputValue(event.startsAt, event.timeZone) : `${calendarDayKey(fallbackDay)}T09:00`,
    endsAt: event.endsAt ? zonedInputValue(event.endsAt, event.timeZone) : `${calendarDayKey(fallbackDay)}T10:00`,
    startDate: event.startDate ?? calendarDayKey(fallbackDay),
    endDateExclusive: event.endDateExclusive ?? calendarDayKey(addDays(fallbackDay, 1)),
    location: event.location ?? "",
    notes: event.notes ?? "",
    recurrenceFrequency: recurrence?.frequency ?? "none",
    recurrenceInterval: String(recurrence?.interval ?? 1),
    recurrenceEndDate: recurrence?.endDate ?? "",
    recurrenceWeekdays: recurrence?.weekdays ?? [fallbackDay.getUTCDay()],
    personIds: event.personIds,
    reminderMinutes: event.reminderMinutes,
    transportMode: event.transport.mode,
    pickupPersonId: event.transport.pickupPersonId ?? "",
    dropoffPersonId: event.transport.dropoffPersonId ?? "",
    transportNotes: event.transport.notes ?? "",
    startFold: null,
    endFold: null,
  };
}

function displayKey(item: CalendarDisplayEvent): string {
  return item.occurrenceId ?? item.event.id;
}

function expandDisplayEvents(
  items: readonly CalendarDisplayEvent[],
  rangeStart: Date,
  rangeEndExclusive: Date,
): readonly CalendarDisplayEvent[] {
  const start = calendarDayKey(rangeStart);
  const end = calendarDayKey(rangeEndExclusive);
  const expanded: CalendarDisplayEvent[] = [];
  for (const item of items) {
    const series = item.event;
    for (const occurrence of expandCalendarEvent(series, start, end)) {
      const event: CalendarEvent = Object.freeze({
        ...series,
        ...occurrence.event,
      });
      expanded.push(Object.freeze({
        ...item,
        event,
        occurrenceId: occurrence.occurrenceId,
        occurrenceDate: occurrence.occurrenceDate,
        seriesEvent: series,
        recurring: occurrence.recurring,
        overridden: occurrence.overridden,
      }));
    }
  }
  return Object.freeze(expanded.sort((left, right) => {
    const a = left.event.allDay ? `${left.event.startDate ?? ""}T00:00:00` : left.event.startsAt ?? "";
    const b = right.event.allDay ? `${right.event.startDate ?? ""}T00:00:00` : right.event.startsAt ?? "";
    return a.localeCompare(b) || displayKey(left).localeCompare(displayKey(right));
  }));
}

function emptyView(): CalendarLocalView {
  return Object.freeze({ events: Object.freeze([]), issues: Object.freeze([]), pendingCount: 0 });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The Calendar request failed.";
}

function settingsDraft(settings: CalendarSettings): SettingsDraft {
  return {
    defaultView: settings.defaultView,
    weekStart: settings.weekStart,
    timeZone: settings.timeZone,
    defaultReminder: settings.defaultReminder,
    defaultCalendarId: settings.defaultCalendarId,
  };
}

function formatRangeTitle(
  view: CalendarViewName,
  cursor: Date,
  weekStart: "sunday" | "monday",
): string {
  if (view === "day") {
    return formatCalendarDate(cursor, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }
  if (view === "week") {
    const start = startOfWeek(cursor, weekStart);
    return `${formatCalendarDate(start, { month: "short", day: "numeric" })} – ${formatCalendarDate(addDays(start, 6), { month: "short", day: "numeric", year: "numeric" })}`;
  }
  return view === "month"
    ? formatCalendarDate(cursor, { month: "long", year: "numeric" })
    : "Upcoming";
}

function MiniMonth({ cursor, weekStart, timeZone, onSelect }: {
  cursor: Date;
  weekStart: "sunday" | "monday";
  timeZone: string;
  onSelect(date: Date): void;
}) {
  const first = calendarDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1);
  const gridStart = startOfWeek(first, weekStart);
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const headerStart = startOfWeek(calendarDate(2026, 1, 4), weekStart);
  const todayKey = calendarDayKey(calendarToday(timeZone));
  return (
    <div className="mini-calendar">
      <strong>{formatCalendarDate(cursor, { month: "long", year: "numeric" })}</strong>
      <div className="mini-weekdays">
        {Array.from({ length: 7 }, (_, index) => (
          <span key={index}>{formatCalendarDate(addDays(headerStart, index), { weekday: "narrow" })}</span>
        ))}
      </div>
      <div className="mini-days">
        {days.map((day) => (
          <button
            key={calendarDayKey(day)}
            type="button"
            className={(day.getUTCMonth() !== cursor.getUTCMonth() ? " outside" : "") + (calendarDayKey(day) === calendarDayKey(cursor) ? " selected" : "") + (calendarDayKey(day) === todayKey ? " today" : "")}
            onClick={() => onSelect(day)}
          >
            {day.getUTCDate()}
          </button>
        ))}
      </div>
    </div>
  );
}

function TimeGrid({ days, events, timeZone, colorFor, onEdit }: {
  days: Date[];
  events: readonly CalendarDisplayEvent[];
  timeZone: string;
  colorFor(event: CalendarEvent): string;
  onEdit(item: CalendarDisplayEvent): void;
}) {
  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", timeZone: "UTC" });
  const eventTimeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone });
  return (
    <div className="calendar-time-view">
      <div className="calendar-week-header" style={{ gridTemplateColumns: `58px repeat(${days.length}, minmax(120px, 1fr))` }}>
        <span />
        {days.map((day) => <div key={calendarDayKey(day)} className="calendar-column-heading"><span>{formatCalendarDate(day, { weekday: "short", month: "short", day: "numeric" })}</span></div>)}
      </div>
      <div className="calendar-all-day" style={{ gridTemplateColumns: `58px repeat(${days.length}, minmax(120px, 1fr))` }}>
        <span className="calendar-all-day-label">All day</span>
        {days.map((day) => {
          const key = calendarDayKey(day);
          const items = events.filter((item) => item.event.allDay && eventOverlapsDay(item.event, day, timeZone));
          return <div className="calendar-all-day-cell" key={key}>{items.map((item) => (
            <button key={`${displayKey(item)}:${key}`} type="button" className="calendar-chip" style={{ background: colorFor(item.event) }} onClick={() => onEdit(item)}>{item.event.title}</button>
          ))}</div>;
        })}
      </div>
      <div className="calendar-time-scroll">
        <div className="calendar-hour-axis" style={{ height: GRID_HEIGHT }}>
          {Array.from({ length: 24 }, (_, hour) => <span key={hour} style={{ top: hour * HOUR_HEIGHT }}>{timeFormat.format(new Date(Date.UTC(2026, 0, 1, hour)))}</span>)}
        </div>
        <div className="calendar-day-columns" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(120px, 1fr))`, height: GRID_HEIGHT }}>
          {days.map((day) => {
            const key = calendarDayKey(day);
            const positioned = events
              .filter((item) => !item.event.allDay && eventOverlapsDay(item.event, day, timeZone))
              .map((item) => ({ item, segment: eventSegment(item.event, day, timeZone) }))
              .filter((entry): entry is { item: CalendarDisplayEvent; segment: NonNullable<ReturnType<typeof eventSegment>> } => entry.segment !== null)
              .sort((a, b) => a.segment.startMinute - b.segment.startMinute || a.segment.endMinute - b.segment.endMinute || displayKey(a.item).localeCompare(displayKey(b.item)));
            const laneEnds: number[] = [];
            const laidOut = positioned.map((entry) => {
              let lane = laneEnds.findIndex((end) => end <= entry.segment.startMinute);
              if (lane < 0) lane = laneEnds.length;
              laneEnds[lane] = entry.segment.endMinute;
              return { ...entry, lane };
            });
            const laneCount = Math.max(1, laneEnds.length);
            return <div key={key} className="calendar-time-column">{laidOut.map(({ item, segment, lane }) => (
              <button
                key={`${displayKey(item)}:${key}`}
                type="button"
                className={"calendar-block" + (item.pending ? " pending" : "")}
                style={{
                  top: (segment.startMinute / 1440) * GRID_HEIGHT,
                  height: Math.max(28, ((Math.min(segment.endMinute, 1440) - segment.startMinute) / 1440) * GRID_HEIGHT),
                  background: colorFor(item.event),
                  left: `calc(${(lane / laneCount) * 100}% + 2px)`,
                  right: "auto",
                  width: `calc(${100 / laneCount}% - 4px)`,
                }}
                onClick={() => onEdit(item)}
                disabled={!item.editable}
              ><strong>{item.event.title}</strong><span>{eventTimeFormat.format(segment.clippedStart)}</span></button>
            ))}</div>;
          })}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ cursor, weekStart, timeZone, events, colorFor, onSelectDate, onEdit }: {
  cursor: Date;
  weekStart: "sunday" | "monday";
  timeZone: string;
  events: readonly CalendarDisplayEvent[];
  colorFor(event: CalendarEvent): string;
  onSelectDate(date: Date): void;
  onEdit(item: CalendarDisplayEvent): void;
}) {
  const first = calendarDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1);
  const start = startOfWeek(first, weekStart);
  const days = Array.from({ length: 42 }, (_, index) => addDays(start, index));
  const weekdayStart = startOfWeek(calendarDate(2026, 1, 4), weekStart);
  const todayKey = calendarDayKey(calendarToday(timeZone));
  const selectedKey = calendarDayKey(cursor);
  return <div className="calendar-month-view">
    <div className="calendar-month-weekdays">{Array.from({ length: 7 }, (_, index) => <span key={index}>{formatCalendarDate(addDays(weekdayStart, index), { weekday: "short" })}</span>)}</div>
    <div className="calendar-month-grid">{days.map((day) => {
      const key = calendarDayKey(day);
      const items = events.filter((item) => eventOverlapsDay(item.event, day, timeZone));
      return <div key={key} className={"calendar-month-cell" + (day.getUTCMonth() !== cursor.getUTCMonth() ? " outside" : "") + (key === todayKey ? " today" : "") + (key === selectedKey ? " selected-date" : "")}>
        <button className="calendar-date-number" type="button" onClick={() => onSelectDate(day)}>{day.getUTCDate()}</button>
        <div className="calendar-month-events">{items.slice(0, 3).map((item) => <button key={`${displayKey(item)}:${key}`} type="button" className="calendar-month-event" onClick={() => onEdit(item)} disabled={!item.editable}><span className="calendar-color-dot" style={{ background: colorFor(item.event) }} /><span>{item.event.title}</span></button>)}{items.length > 3 && <span className="calendar-more">+{items.length - 3} more</span>}</div>
      </div>;
    })}</div>
  </div>;
}

function Upcoming({ events, timeZone, colorFor, onEdit }: {
  events: readonly CalendarDisplayEvent[];
  timeZone: string;
  colorFor(event: CalendarEvent): string;
  onEdit(item: CalendarDisplayEvent): void;
}) {
  const now = Date.now() - DAY_MS;
  const todayKey = calendarDayKey(calendarToday(timeZone));
  const items = events.filter(({ event }) => event.allDay
    ? event.endDateExclusive !== null && event.endDateExclusive > todayKey
    : event.endsAt !== null && Date.parse(event.endsAt) >= now).slice(0, 60);
  const timedDate = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone });
  const timedClock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone });
  return <div className="calendar-upcoming-list">{items.length === 0 ? <div className="calendar-empty"><strong>No upcoming events</strong></div> : items.map((item) => {
    const event = item.event;
    const dateLabel = event.allDay && event.startDate
      ? formatCalendarDate(dateFromKey(event.startDate), { weekday: "short", month: "short", day: "numeric" })
      : event.startsAt ? timedDate.format(new Date(event.startsAt)) : "";
    return <button key={displayKey(item)} type="button" className="calendar-upcoming-event" onClick={() => onEdit(item)} disabled={!item.editable}>
      <span className="calendar-upcoming-bar" style={{ background: colorFor(event) }} />
      <span className="calendar-upcoming-date">{dateLabel}</span>
      <span className="calendar-upcoming-main"><strong>{event.title}</strong>{event.location && <small>{event.location}</small>}</span>
      <span className="calendar-upcoming-time">{event.allDay ? "All day" : event.startsAt ? timedClock.format(new Date(event.startsAt)) : ""}</span>
      {item.pending && <span className="pending-label">Pending</span>}
    </button>;
  })}</div>;
}


function SummaryEvents({
  events,
  timeZone,
  colorFor,
  onEdit,
  limit = 5,
}: {
  events: readonly CalendarDisplayEvent[];
  timeZone: string;
  colorFor(event: CalendarEvent): string;
  onEdit(item: CalendarDisplayEvent): void;
  limit?: number;
}) {
  const timedDate = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  const items = events.slice(0, limit);
  if (items.length === 0) {
    return <p className="calendar-summary-empty">Nothing scheduled.</p>;
  }
  return <div className="calendar-summary-list">{items.map((item) => {
    const event = item.event;
    const when = event.allDay && event.startDate
      ? `${formatCalendarDate(dateFromKey(event.startDate), { month: "short", day: "numeric" })} · All day`
      : event.startsAt ? timedDate.format(new Date(event.startsAt)) : "";
    return <button
      key={displayKey(item)}
      type="button"
      className="calendar-summary-event"
      onClick={() => onEdit(item)}
      disabled={!item.editable}
    >
      <span className="calendar-summary-color" style={{ background: colorFor(event) }} />
      <span><strong>{event.title}</strong><small>{when}</small></span>
    </button>;
  })}</div>;
}

export function CalendarView({ authSubject, householdId, clientId, timeZone, canSync, syncToken, onSync }: CalendarViewProps) {
  const [view, setView] = useState<CalendarLocalView>(emptyView);
  const [people, setPeople] = useState<readonly CalendarPerson[]>([]);
  const [layers, setLayers] = useState<readonly CalendarLayer[]>([]);
  const [settings, setSettings] = useState<CalendarSettings | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [setupColor, setSetupColor] = useState<CalendarColor>("blue");
  const [activeView, setActiveView] = useState<CalendarViewName | null>(null);
  const [cursor, setCursor] = useState(() => calendarToday(timeZone));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingSettings, setEditingSettings] = useState(false);
  const [newLayerName, setNewLayerName] = useState("");
  const [newLayerColor, setNewLayerColor] = useState<CalendarColor>("green");
  const [layerEdit, setLayerEdit] = useState<LayerEditDraft | null>(null);
  const [hiddenLayerIds, setHiddenLayerIds] = useState<readonly string[]>([]);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [localView, cachedSettings, cachedLayers, cachedPeople] = await Promise.all([
        loadCalendarLocalView(authSubject, householdId),
        loadCalendarSettings(authSubject, householdId),
        loadCalendarLayers(authSubject, householdId),
        loadCalendarPeople(authSubject, householdId),
      ]);
      setView(localView);
      setLayers(cachedLayers);
      setPeople(cachedPeople);
      let nextSettings = cachedSettings;
      let nextLayers = cachedLayers;
      let nextPeople = cachedPeople;
      if (cachedSettings) {
        setSettings(cachedSettings);
        setActiveView((current) => current ?? cachedSettings.defaultView);
      }
      if (canSync) {
        try {
          [nextLayers, nextSettings, nextPeople] = await Promise.all([
            refreshCalendarLayers(authSubject, householdId, clientId),
            refreshCalendarSettings(authSubject, householdId, clientId),
            refreshCalendarPeople(authSubject, householdId, clientId),
          ]);
          setLayers(nextLayers);
          setPeople(nextPeople);
          setHiddenLayerIds((current) => current.filter((id) => nextLayers.some((layer) => layer.id === id)));
        } catch (error) {
          if (!cachedSettings || cachedLayers.length === 0) throw error;
          setFailure("Calendar could not be refreshed. Using the last saved Calendar state on this device.");
          return;
        }
      }
      if (!nextSettings && nextLayers.length > 0) {
        nextSettings = unconfiguredCalendarSettings(householdId, timeZone, nextLayers[0]!.id);
      }
      if (!nextSettings) throw new Error("Calendar has no configured local calendar yet.");
      setSettings(nextSettings);
      setActiveView((current) => current ?? nextSettings.defaultView);
      const defaultLayer = nextLayers.find((layer) => layer.id === nextSettings.defaultCalendarId);
      if (defaultLayer) setSetupColor(defaultLayer.color);
      setFailure(null);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [authSubject, householdId, clientId, timeZone, canSync]);

  useEffect(() => { void reload(); }, [reload, syncToken]);

  async function syncAndReload(): Promise<void> {
    await reload();
    if (canSync) {
      await onSync();
      await reload();
    }
  }

  async function saveSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || busy || !canSync) {
      if (!canSync) setFailure("Connect to Homi before saving Calendar settings.");
      return;
    }
    const submitted = draft ?? settingsDraft(settings);
    const selectedLayer = layers.find((layer) => layer.id === submitted.defaultCalendarId);
    if (!selectedLayer) {
      setFailure("Choose an active default calendar.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      let authoritativeLayer = selectedLayer;
      if (selectedLayer.color !== setupColor) {
        const layerResult = await updateCalendarLayerOnline(
          authSubject, householdId, clientId, selectedLayer.id,
          { baseRevision: selectedLayer.revision, name: selectedLayer.name, color: setupColor },
        );
        authoritativeLayer = layerResult.calendar;
        if (layerResult.status === "conflict") {
          setLayers((current) => current.map((layer) => layer.id === authoritativeLayer.id ? authoritativeLayer : layer));
          setSetupColor(authoritativeLayer.color);
          setFailure("That calendar changed elsewhere. The newest color is shown; review and save again.");
          return;
        }
      }
      const payload: CalendarSettingsWrite = {
        baseRevision: settings.revision,
        state: "configured",
        ...submitted,
      };
      const result = await saveCalendarSettingsOnline(authSubject, householdId, clientId, payload);
      setSettings(result.settings);
      setDraft(settingsDraft(result.settings));
      if (result.status === "conflict") {
        setFailure("Calendar settings changed elsewhere. The newest settings are shown; review and save again.");
      } else {
        setActiveView(result.settings.defaultView);
        setEditingSettings(false);
        await onSync();
      }
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function addLayer() {
    const name = newLayerName.trim();
    if (!name || !canSync || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await createCalendarLayerOnline(
        authSubject, householdId, clientId,
        { id: crypto.randomUUID(), name, color: newLayerColor },
      );
      setLayers((current) => Object.freeze([...current, result.calendar]));
      setNewLayerName("");
      await onSync();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveLayerEdit() {
    if (!layerEdit || !canSync || busy) return;
    const name = layerEdit.name.trim();
    if (!name) {
      setFailure("Calendar name is required.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const result = await updateCalendarLayerOnline(
        authSubject,
        householdId,
        clientId,
        layerEdit.id,
        { baseRevision: layerEdit.revision, name, color: layerEdit.color },
      );
      setLayers((current) => current.map((layer) =>
        layer.id === result.calendar.id ? result.calendar : layer,
      ));
      if (result.status === "conflict") {
        setLayerEdit({
          id: result.calendar.id,
          name: result.calendar.name,
          color: result.calendar.color,
          revision: result.calendar.revision,
        });
        setFailure("That calendar changed elsewhere. The newest values are shown; review and save again.");
      } else {
        setLayerEdit(null);
        if (result.calendar.id === effectiveSettings.defaultCalendarId) {
          setSetupColor(result.calendar.color);
        }
        await onSync();
      }
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeLayer(layer: CalendarLayer) {
    if (!canSync || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await deleteCalendarLayerOnline(
        authSubject, householdId, clientId, layer.id, { baseRevision: layer.revision },
      );
      if (result.status === "deleted") {
        setLayers((current) => current.filter((item) => item.id !== layer.id));
        setHiddenLayerIds((current) => current.filter((id) => id !== layer.id));
        if (layerEdit?.id === layer.id) setLayerEdit(null);
      } else {
        setLayers((current) => current.map((item) => item.id === layer.id ? result.calendar : item));
        setFailure("That calendar changed elsewhere and was not deleted.");
      }
      await onSync();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || busy) return;
    const currentTimeZone = editor.timeZone;
    if (!validTimeZone(currentTimeZone)) {
      setFailure("Event time zone must be a valid IANA time zone, such as America/Toronto.");
      return;
    }

    let payload: CalendarEventPayload;
    try {
      const interval = Number(editor.recurrenceInterval);
      if (editor.recurrenceFrequency !== "none"
        && (!Number.isSafeInteger(interval) || interval < 1 || interval > 99)) {
        throw new Error("Repeat interval must be a whole number from 1 to 99.");
      }
      if (editor.recurrenceFrequency === "weekly" && editor.recurrenceWeekdays.length === 0) {
        throw new Error("Choose at least one weekday for weekly recurrence.");
      }
      const recurrence = editor.recurrenceFrequency === "none" ? null : {
        frequency: editor.recurrenceFrequency,
        interval,
        weekdays: editor.recurrenceFrequency === "weekly"
          ? [...editor.recurrenceWeekdays].sort((a, b) => a - b)
          : [],
        endDate: editor.recurrenceEndDate || null,
      } as const;
      const priorRecurrence = editor.seriesEvent?.recurrence ?? null;
      const recurrenceChanged = JSON.stringify(priorRecurrence) !== JSON.stringify(recurrence);
      const recurrenceOverrides = recurrence === null
        ? []
        : recurrenceChanged
          ? []
          : editor.seriesEvent?.recurrenceOverrides ?? [];
      const transport = {
        mode: editor.transportMode,
        pickupPersonId:
          editor.transportMode === "pickup" || editor.transportMode === "round-trip"
            ? editor.pickupPersonId || null
            : null,
        dropoffPersonId:
          editor.transportMode === "dropoff" || editor.transportMode === "round-trip"
            ? editor.dropoffPersonId || null
            : null,
        notes: editor.transportNotes.trim() || null,
      } as const;
      if ((editor.transportMode === "pickup" || editor.transportMode === "round-trip")
        && !transport.pickupPersonId) {
        throw new Error("Choose who is handling pickup.");
      }
      if ((editor.transportMode === "dropoff" || editor.transportMode === "round-trip")
        && !transport.dropoffPersonId) {
        throw new Error("Choose who is handling drop-off.");
      }

      const shared = {
        calendarId: editor.calendarId,
        title: editor.title.trim(),
        description: editor.description.trim() || null,
        timeZone: currentTimeZone,
        location: editor.location.trim() || null,
        notes: editor.notes.trim() || null,
        personIds: [...editor.personIds],
        reminderMinutes: [...editor.reminderMinutes].sort((a, b) => a - b),
        transport,
      } as const;
      if (!shared.title) throw new Error("Event title is required.");

      if (editor.allDay) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(editor.startDate)
          || !/^\d{4}-\d{2}-\d{2}$/.test(editor.endDateExclusive)
          || editor.endDateExclusive <= editor.startDate) {
          throw new Error("All-day event end date must be after its start date.");
        }
        payload = {
          ...shared,
          allDay: true,
          startsAt: null,
          endsAt: null,
          startDate: editor.startDate,
          endDateExclusive: editor.endDateExclusive,
          recurrence,
          recurrenceOverrides,
        };
      } else {
        const startsAt = resolveEditorInstant(
          editor.startsAt,
          currentTimeZone,
          editor.event?.startsAt ?? null,
          editor.startFold,
        );
        const endsAt = resolveEditorInstant(
          editor.endsAt,
          currentTimeZone,
          editor.event?.endsAt ?? null,
          editor.endFold,
        );
        if (endsAt <= startsAt) throw new Error("Event end time must be after its start time.");
        payload = {
          ...shared,
          allDay: false,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          startDate: null,
          endDateExclusive: null,
          recurrence,
          recurrenceOverrides,
        };
      }
    } catch (error) {
      setFailure(errorMessage(error));
      return;
    }

    setBusy(true);
    setFailure(null);
    try {
      if (editor.kind === "create") {
        await queueCalendarCreate(authSubject, householdId, payload);
      } else if (
        editor.editScope === "occurrence"
        && editor.seriesEvent?.recurrence
        && editor.occurrenceDate
      ) {
        const replacement = {
          calendarId: payload.calendarId!,
          title: payload.title!,
          description: payload.description ?? null,
          allDay: payload.allDay!,
          timeZone: payload.timeZone!,
          startsAt: payload.startsAt ?? null,
          endsAt: payload.endsAt ?? null,
          startDate: payload.startDate ?? null,
          endDateExclusive: payload.endDateExclusive ?? null,
          location: payload.location ?? null,
          notes: payload.notes ?? null,
          personIds: payload.personIds ?? [],
          reminderMinutes: payload.reminderMinutes ?? [],
          transport: payload.transport!,
        };
        const nextOverrides = [
          ...editor.seriesEvent.recurrenceOverrides.filter(
            (override) => override.occurrenceDate !== editor.occurrenceDate,
          ),
          {
            occurrenceDate: editor.occurrenceDate,
            action: "replace" as const,
            replacement,
          },
        ].sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
        await queueCalendarUpdate(
          authSubject,
          householdId,
          editor.seriesEvent,
          { recurrenceOverrides: nextOverrides },
        );
      } else if (editor.seriesEvent ?? editor.event) {
        await queueCalendarUpdate(
          authSubject,
          householdId,
          (editor.seriesEvent ?? editor.event)!,
          payload,
        );
      }
      setEditor(null);
      setConfirmDelete(false);
      await syncAndReload();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteEditorEvent() {
    if (!editor?.event || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      if (
        editor.editScope === "occurrence"
        && editor.seriesEvent?.recurrence
        && editor.occurrenceDate
      ) {
        const nextOverrides = [
          ...editor.seriesEvent.recurrenceOverrides.filter(
            (override) => override.occurrenceDate !== editor.occurrenceDate,
          ),
          {
            occurrenceDate: editor.occurrenceDate,
            action: "skip" as const,
            replacement: null,
          },
        ].sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
        await queueCalendarUpdate(
          authSubject,
          householdId,
          editor.seriesEvent,
          { recurrenceOverrides: nextOverrides },
        );
      } else {
        await queueCalendarDelete(
          authSubject,
          householdId,
          (editor.seriesEvent ?? editor.event),
        );
      }
      setEditor(null);
      setConfirmDelete(false);
      await syncAndReload();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function dismissIssue(clientMutationId: string) {
    setBusy(true);
    try {
      await dismissCalendarIssue(authSubject, clientMutationId);
      await reload();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function navigate(amount: number) {
    const mode = activeView ?? settings?.defaultView ?? "week";
    if (mode === "day") setCursor((current) => addDays(current, amount));
    else if (mode === "week") setCursor((current) => addDays(current, amount * 7));
    else if (mode === "month") setCursor((current) => calendarDate(current.getUTCFullYear(), current.getUTCMonth() + amount + 1, 1));
    else setCursor((current) => addDays(current, amount * 14));
  }

  if (loading && (!settings || layers.length === 0)) {
    return <section className="calendar-module"><div className="calendar-empty">Loading Calendar…</div></section>;
  }
  if (!settings || layers.length === 0) {
    return <section className="calendar-module"><div className="calendar-empty"><strong>Calendar needs attention</strong><span>{failure ?? "No local calendar is available."}</span></div></section>;
  }

  const effectiveSettings = settings;
  const mode = activeView ?? effectiveSettings.defaultView;
  const setupRequired = effectiveSettings.state !== "configured";
  const showSetup = setupRequired || editingSettings;
  const setupDraft = draft ?? settingsDraft(effectiveSettings);
  const defaultLayer = layers.find((layer) => layer.id === setupDraft.defaultCalendarId) ?? layers[0]!;
  const layerMap = new Map(layers.map((layer) => [layer.id, layer]));
  const peopleMap = new Map(people.map((person) => [person.id, person]));
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const baseVisibleEvents = view.events.filter((item) => {
    if (hiddenLayerIds.includes(item.event.calendarId)) return false;
    if (!normalizedSearch) return true;
    const event = item.event;
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
    const haystack = [
      event.title, event.description ?? "", event.notes ?? "", event.location ?? "",
      ...overrideText,
      ...[...relatedPersonIds].map((id) => peopleMap.get(id)?.displayName ?? ""),
    ].join("\n").toLocaleLowerCase();
    return haystack.includes(normalizedSearch);
  });
  const today = calendarToday(effectiveSettings.timeZone);
  const rangeFloor = cursor < today ? cursor : today;
  const rangeCeiling = cursor > today ? cursor : today;
  const visibleEvents = expandDisplayEvents(baseVisibleEvents, addDays(rangeFloor, -62), addDays(rangeCeiling, 400));
  const colorFor = (event: CalendarEvent) => CALENDAR_COLORS[layerMap.get(event.calendarId)?.color ?? "blue"];
  const startNeedsFold = editor !== null && !editor.allDay
    && validTimeZone(editor.timeZone)
    && localInputCandidates(editor.startsAt, editor.timeZone).length > 1
    && (!editor.event || !editor.event.startsAt || zonedInputValue(editor.event.startsAt, editor.timeZone) !== editor.startsAt);
  const endNeedsFold = editor !== null && !editor.allDay
    && validTimeZone(editor.timeZone)
    && localInputCandidates(editor.endsAt, editor.timeZone).length > 1
    && (!editor.event || !editor.event.endsAt || zonedInputValue(editor.event.endsAt, editor.timeZone) !== editor.endsAt);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(cursor, effectiveSettings.weekStart), index));
  const dayItems = visibleEvents.filter((item) => eventOverlapsDay(item.event, cursor, effectiveSettings.timeZone));
  const todayKey = calendarDayKey(today);
  const todayItems = visibleEvents.filter((item) => eventOverlapsDay(item.event, today, effectiveSettings.timeZone));
  const upcomingItems = visibleEvents.filter(({ event }) => event.allDay
    ? event.endDateExclusive !== null && event.endDateExclusive > todayKey
    : event.endsAt !== null && Date.parse(event.endsAt) >= Date.now());

  if (showSetup) {
    return <section className="calendar-module calendar-setup-shell" aria-labelledby="calendar-setup-heading">
      <div className="calendar-setup-intro"><p className="eyebrow">Calendar setup</p><h2 id="calendar-setup-heading">{setupRequired ? "Set up your household Calendar" : "Calendar settings"}</h2><p>These settings and calendar layers are stored with your household on the Homi server.</p></div>
      {failure && <div className="calendar-message error-card" role="alert">{failure}</div>}
      <form className="calendar-setup-form" onSubmit={saveSetup}>
        <div className="calendar-settings-grid">
          <label>Default view<select value={setupDraft.defaultView} onChange={(e) => setDraft({ ...setupDraft, defaultView: e.target.value as CalendarViewName })} disabled={busy}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="upcoming">Upcoming</option></select></label>
          <label>Week starts on<select value={setupDraft.weekStart} onChange={(e) => setDraft({ ...setupDraft, weekStart: e.target.value as "sunday" | "monday" })} disabled={busy}><option value="sunday">Sunday</option><option value="monday">Monday</option></select></label>
          <label>Calendar time zone<input type="text" value={setupDraft.timeZone} onChange={(e) => setDraft({ ...setupDraft, timeZone: e.target.value })} disabled={busy} required /></label>
          <label>Default reminder<select value={setupDraft.defaultReminder} onChange={(e) => setDraft({ ...setupDraft, defaultReminder: e.target.value as SettingsDraft["defaultReminder"] })} disabled={busy}><option value="none">None</option><option value="30m">30 minutes before</option><option value="1h">1 hour before</option></select></label>
          <label>Default calendar<select value={setupDraft.defaultCalendarId} onChange={(e) => { const id = e.target.value; const layer = layers.find((item) => item.id === id); setDraft({ ...setupDraft, defaultCalendarId: id }); if (layer) setSetupColor(layer.color); }} disabled={busy}>{layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label>
        </div>
        <fieldset className="calendar-color-picker"><legend>{defaultLayer.name} color</legend><div className="calendar-color-options">{(Object.keys(CALENDAR_COLORS) as CalendarColor[]).map((name) => <button key={name} type="button" className={"calendar-color-choice" + (setupColor === name ? " selected" : "")} title={name} aria-label={name} onClick={() => setSetupColor(name)} disabled={busy}><span style={{ background: CALENDAR_COLORS[name] }} /></button>)}</div></fieldset>
        {!setupRequired && <div className="calendar-layer-settings"><h3>Household calendars</h3>{layers.map((layer) => layerEdit?.id === layer.id ? <div className="calendar-layer-edit-row" key={layer.id}><input value={layerEdit.name} maxLength={200} onChange={(e) => setLayerEdit({ ...layerEdit, name: e.target.value })} disabled={busy} /><select value={layerEdit.color} onChange={(e) => setLayerEdit({ ...layerEdit, color: e.target.value as CalendarColor })} disabled={busy}>{(Object.keys(CALENDAR_COLORS) as CalendarColor[]).map((color) => <option key={color} value={color}>{color}</option>)}</select><button type="button" className="secondary-button" onClick={() => void saveLayerEdit()} disabled={busy || !canSync || !layerEdit.name.trim()}>Save</button><button type="button" className="quiet-button" onClick={() => setLayerEdit(null)} disabled={busy}>Cancel</button></div> : <div className="calendar-layer-setting-row" key={layer.id}><span className="calendar-color-dot" style={{ background: CALENDAR_COLORS[layer.color] }} /><strong>{layer.name}</strong><span>{layer.id === effectiveSettings.defaultCalendarId ? "Default" : ""}</span><button type="button" className="quiet-button" disabled={busy || !canSync} onClick={() => setLayerEdit({ id: layer.id, name: layer.name, color: layer.color, revision: layer.revision })}>Edit</button>{layer.id !== effectiveSettings.defaultCalendarId && layers.length > 1 && <button type="button" className="danger-link" disabled={busy || !canSync} onClick={() => void removeLayer(layer)}>Delete</button>}</div>)}<div className="calendar-add-layer"><input value={newLayerName} onChange={(e) => setNewLayerName(e.target.value)} placeholder="New calendar name" maxLength={200} /><select value={newLayerColor} onChange={(e) => setNewLayerColor(e.target.value as CalendarColor)}>{(Object.keys(CALENDAR_COLORS) as CalendarColor[]).map((color) => <option key={color} value={color}>{color}</option>)}</select><button type="button" className="secondary-button" onClick={() => void addLayer()} disabled={busy || !canSync || !newLayerName.trim()}>Add calendar</button></div></div>}
        <div className="calendar-setup-note"><strong>External calendars</strong><span>Google Calendar, Apple Calendar and Outlook synchronization remain required later in Master Step 5; they are not connected in this build yet.</span></div>
        <div className="editor-actions">{!setupRequired && <button className="quiet-button" type="button" onClick={() => { setEditingSettings(false); setDraft(null); }} disabled={busy}>Cancel</button>}<button className="primary-button" type="submit" disabled={busy || !canSync}>{busy ? "Saving…" : setupRequired ? "Finish Calendar setup" : "Save settings"}</button></div>
      </form>
    </section>;
  }

  function openEvent(item: CalendarDisplayEvent) {
    if (!item.editable) return;
    setEditor(item.recurring && item.seriesEvent && item.occurrenceDate
      ? editEditor(item.event, item.seriesEvent, item.occurrenceDate, "occurrence")
      : editEditor(item.event));
    setConfirmDelete(false);
  }

  const openCreate = () => setEditor(
    initialCreateEditor(
      effectiveSettings.timeZone,
      effectiveSettings.defaultCalendarId,
      cursor,
      effectiveSettings.defaultReminder,
    ),
  );

  function renderCalendarSurface() {
    if (mode === "day") {
      return <TimeGrid
        days={[cursor]}
        events={visibleEvents}
        timeZone={effectiveSettings.timeZone}
        colorFor={colorFor}
        onEdit={openEvent}
      />;
    }
    if (mode === "week") {
      return <TimeGrid
        days={weekDays}
        events={visibleEvents}
        timeZone={effectiveSettings.timeZone}
        colorFor={colorFor}
        onEdit={openEvent}
      />;
    }
    if (mode === "month") {
      return <MonthGrid
        cursor={cursor}
        weekStart={effectiveSettings.weekStart}
        timeZone={effectiveSettings.timeZone}
        events={visibleEvents}
        colorFor={colorFor}
        onSelectDate={(day) => {
          setCursor(day);
          setActiveView("day");
        }}
        onEdit={openEvent}
      />;
    }
    return <Upcoming
      events={visibleEvents}
      timeZone={effectiveSettings.timeZone}
      colorFor={colorFor}
      onEdit={openEvent}
    />;
  }

  return <section className="calendar-module calendar-workspace" aria-labelledby="calendar-heading">
    {failure && <div className="calendar-message error-card" role="alert">{failure}</div>}
    {view.issues.length > 0 && <div className="calendar-issues">{view.issues.map((issue) => <div className="calendar-message warning-card" key={issue.clientMutationId}><div><strong>{issue.status === "conflict" ? "Calendar change needs review" : "Calendar change was not accepted"}</strong><span>{issue.lastErrorCode ?? "The server could not apply this change."}</span></div><button className="quiet-button" type="button" disabled={busy} onClick={() => void dismissIssue(issue.clientMutationId)}>Dismiss</button></div>)}</div>}

    <div className="calendar-mobile-panel">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Calendar</p>
          <h2 id="calendar-heading">Today</h2>
          <p className="module-subtitle">{view.pendingCount ? `${view.pendingCount} change${view.pendingCount === 1 ? "" : "s"} pending sync` : formatCalendarDate(today, { weekday: "long", month: "long", day: "numeric" })}</p>
        </div>
        <div className="calendar-mobile-actions">
          <button className="quiet-button" type="button" onClick={() => { setDraft(settingsDraft(effectiveSettings)); setSetupColor(layerMap.get(effectiveSettings.defaultCalendarId)?.color ?? "blue"); setEditingSettings(true); }}>Settings</button>
          <button className="primary-button compact-button" type="button" onClick={openCreate}>+ Add</button>
        </div>
      </div>
      <label className="calendar-search-field">
        <span>Search Calendar</span>
        <input type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Events, notes, locations or people" />
      </label>
      <Upcoming
        events={[...todayItems, ...upcomingItems.filter((item) => !todayItems.includes(item))]}
        timeZone={effectiveSettings.timeZone}
        colorFor={colorFor}
        onEdit={openEvent}
      />
    </div>

    <div className="calendar-desktop-panel">
      <aside className="calendar-sidebar">
        <button className="primary-button calendar-create-button" type="button" onClick={openCreate}>+ Create event</button>
        <label className="calendar-search-field compact">
          <span>Search</span>
          <input type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search Calendar" />
        </label>
        <MiniMonth
          cursor={cursor}
          weekStart={effectiveSettings.weekStart}
          timeZone={effectiveSettings.timeZone}
          onSelect={setCursor}
        />
        <div className="calendar-layer-list">
          <h3>My calendars</h3>
          {layers.map((layer) => <label key={layer.id}>
            <input
              type="checkbox"
              checked={!hiddenLayerIds.includes(layer.id)}
              onChange={() => setHiddenLayerIds((current) => current.includes(layer.id)
                ? current.filter((id) => id !== layer.id)
                : [...current, layer.id])}
            />
            <span className="calendar-color-dot" style={{ background: CALENDAR_COLORS[layer.color] }} />
            <span>{layer.name}</span>
          </label>)}
        </div>
        <button className="quiet-button calendar-settings-button" type="button" onClick={() => { setDraft(settingsDraft(effectiveSettings)); setSetupColor(layerMap.get(effectiveSettings.defaultCalendarId)?.color ?? "blue"); setEditingSettings(true); }}>Calendar settings</button>
        <div className="calendar-sync-caption">{view.pendingCount ? `${view.pendingCount} pending sync` : canSync ? "Synced" : "Offline"}</div>
      </aside>

      <div className="calendar-main">
        <div className="calendar-tablet-overview">
          <section className="calendar-overview-card">
            <div className="calendar-overview-heading">
              <div><p className="eyebrow">Today</p><h3>{formatCalendarDate(today, { weekday: "long", month: "short", day: "numeric" })}</h3></div>
              <button className="primary-button compact-button" type="button" onClick={() => setEditor(initialCreateEditor(effectiveSettings.timeZone, effectiveSettings.defaultCalendarId, today, effectiveSettings.defaultReminder))}>+ Add</button>
            </div>
            <SummaryEvents events={todayItems} timeZone={effectiveSettings.timeZone} colorFor={colorFor} onEdit={openEvent} limit={5} />
          </section>
          <section className="calendar-overview-card">
            <div className="calendar-overview-heading"><div><p className="eyebrow">Next up</p><h3>Upcoming</h3></div></div>
            <SummaryEvents events={upcomingItems.filter((item) => !todayItems.includes(item))} timeZone={effectiveSettings.timeZone} colorFor={colorFor} onEdit={openEvent} limit={5} />
          </section>
        </div>

        <header className="calendar-toolbar">
          <div className="calendar-toolbar-left">
            <button className="quiet-button" type="button" onClick={() => setCursor(today)}>Today</button>
            <button className="calendar-nav-button" type="button" onClick={() => navigate(-1)} aria-label="Previous period">‹</button>
            <button className="calendar-nav-button" type="button" onClick={() => navigate(1)} aria-label="Next period">›</button>
            <div className="calendar-date-picker-wrap">
              <button
                className="calendar-date-picker-button"
                type="button"
                aria-expanded={datePickerOpen}
                onClick={() => setDatePickerOpen((open) => !open)}
              >
                {formatCalendarDate(cursor, { month: "short", day: "numeric" })}
              </button>
              {datePickerOpen && <div className="calendar-date-popover">
                <MiniMonth
                  cursor={cursor}
                  weekStart={effectiveSettings.weekStart}
                  timeZone={effectiveSettings.timeZone}
                  onSelect={(day) => {
                    setCursor(day);
                    setDatePickerOpen(false);
                  }}
                />
              </div>}
            </div>
            <h2>{formatRangeTitle(mode, cursor, effectiveSettings.weekStart)}</h2>
          </div>
          <div className="calendar-view-switch" role="group" aria-label="Calendar view">
            {(["day", "week", "month", "upcoming"] as CalendarViewName[]).map((name) => <button
              key={name}
              className={mode === name ? "active" : ""}
              type="button"
              onClick={() => setActiveView(name)}
            >{name[0]!.toUpperCase() + name.slice(1)}</button>)}
          </div>
        </header>
        <div className="calendar-surface">{renderCalendarSurface()}</div>
      </div>

      <aside className="calendar-context-panel">
        <section>
          <p className="eyebrow">Selected day</p>
          <h3>{formatCalendarDate(cursor, { weekday: "long", month: "short", day: "numeric" })}</h3>
          <SummaryEvents
            events={dayItems}
            timeZone={effectiveSettings.timeZone}
            colorFor={colorFor}
            onEdit={openEvent}
            limit={6}
          />
        </section>
        <section>
          <p className="eyebrow">Next up</p>
          <h3>Upcoming</h3>
          <SummaryEvents
            events={upcomingItems.filter((item) => !dayItems.includes(item))}
            timeZone={effectiveSettings.timeZone}
            colorFor={colorFor}
            onEdit={openEvent}
            limit={6}
          />
        </section>
      </aside>
    </div>
    {editor && <div className="calendar-editor-backdrop">
      <section className="calendar-editor" aria-label="Calendar event editor">
        <div className="editor-heading">
          <div>
            <p className="eyebrow">{editor.kind === "create" ? "New event" : editor.editScope === "occurrence" ? "Edit occurrence" : "Edit event"}</p>
            <h3>{editor.kind === "create" ? "Add to Calendar" : editor.event?.title}</h3>
          </div>
          <button className="quiet-button" type="button" onClick={() => { setEditor(null); setConfirmDelete(false); }} disabled={busy}>Close</button>
        </div>
        {editor.kind === "edit" && editor.occurrenceDate && editor.seriesEvent?.recurrence && <div className="calendar-series-scope">
          <span>This event repeats.</span>
          <div role="group" aria-label="Recurring event edit scope">
            <button
              type="button"
              className={editor.editScope === "occurrence" ? "active" : ""}
              onClick={() => {
                const occurrence = editor.occurrenceEvent;
                if (occurrence && editor.seriesEvent && editor.occurrenceDate) {
                  setEditor(editEditor(occurrence, editor.seriesEvent, editor.occurrenceDate, "occurrence"));
                }
              }}
              disabled={busy}
            >This occurrence</button>
            <button
              type="button"
              className={editor.editScope === "series" ? "active" : ""}
              onClick={() => {
                if (!editor.seriesEvent || !editor.occurrenceDate) return;
                const next = editEditor(editor.seriesEvent, editor.seriesEvent, editor.occurrenceDate, "series");
                setEditor({ ...next, occurrenceEvent: editor.occurrenceEvent });
              }}
              disabled={busy}
            >Entire series</button>
          </div>
        </div>}
        <form className="calendar-form" onSubmit={saveEditor}>
          <label>Event<input type="text" value={editor.title} maxLength={200} required onChange={(e) => setEditor({ ...editor, title: e.target.value })} disabled={busy} /></label>
          <label>Description<textarea value={editor.description} maxLength={5000} rows={3} onChange={(e) => setEditor({ ...editor, description: e.target.value })} disabled={busy} /></label>
          <div className="calendar-form-row">
            <label>Calendar<select value={editor.calendarId} onChange={(e) => setEditor({ ...editor, calendarId: e.target.value })} disabled={busy}>{layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label>
            <label>Event time zone<input type="text" value={editor.timeZone} onChange={(e) => setEditor({ ...editor, timeZone: e.target.value, startFold: null, endFold: null })} disabled={busy} required /></label>
          </div>
          <label className="checkbox-label"><input type="checkbox" checked={editor.allDay} onChange={(e) => setEditor({ ...editor, allDay: e.target.checked, startFold: null, endFold: null })} disabled={busy} />All-day event</label>
          {editor.allDay ? <div className="calendar-form-row">
            <label>Starts<input type="date" value={editor.startDate} required onChange={(e) => setEditor({ ...editor, startDate: e.target.value })} disabled={busy} /></label>
            <label>Ends before<input type="date" value={editor.endDateExclusive} required onChange={(e) => setEditor({ ...editor, endDateExclusive: e.target.value })} disabled={busy} /></label>
          </div> : <div className="calendar-form-row">
            <label>Starts<input type="datetime-local" value={editor.startsAt} required onChange={(e) => setEditor({ ...editor, startsAt: e.target.value, startFold: null })} disabled={busy} />{startNeedsFold && <select aria-label="Start time clock-change occurrence" value={editor.startFold ?? ""} onChange={(e) => setEditor({ ...editor, startFold: e.target.value as "earlier" | "later" })} required disabled={busy}><option value="">Choose clock-change occurrence</option><option value="earlier">First occurrence</option><option value="later">Second occurrence</option></select>}</label>
            <label>Ends<input type="datetime-local" value={editor.endsAt} required onChange={(e) => setEditor({ ...editor, endsAt: e.target.value, endFold: null })} disabled={busy} />{endNeedsFold && <select aria-label="End time clock-change occurrence" value={editor.endFold ?? ""} onChange={(e) => setEditor({ ...editor, endFold: e.target.value as "earlier" | "later" })} required disabled={busy}><option value="">Choose clock-change occurrence</option><option value="earlier">First occurrence</option><option value="later">Second occurrence</option></select>}</label>
          </div>}

          {(editor.kind === "create" || editor.editScope === "series") && <fieldset className="calendar-editor-section">
            <legend>Repeat</legend>
            <div className="calendar-form-row">
              <label>Frequency<select value={editor.recurrenceFrequency} onChange={(e) => setEditor({ ...editor, recurrenceFrequency: e.target.value as EditorState["recurrenceFrequency"] })} disabled={busy}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
              {editor.recurrenceFrequency !== "none" && <label>Every<input type="number" min={1} max={99} value={editor.recurrenceInterval} onChange={(e) => setEditor({ ...editor, recurrenceInterval: e.target.value })} disabled={busy} /></label>}
              {editor.recurrenceFrequency !== "none" && <label>Ends on<input type="date" value={editor.recurrenceEndDate} onChange={(e) => setEditor({ ...editor, recurrenceEndDate: e.target.value })} disabled={busy} /></label>}
            </div>
            {editor.recurrenceFrequency === "weekly" && <div className="calendar-weekday-picker">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, day) => <label key={label}><input type="checkbox" checked={editor.recurrenceWeekdays.includes(day)} onChange={() => setEditor({ ...editor, recurrenceWeekdays: editor.recurrenceWeekdays.includes(day) ? editor.recurrenceWeekdays.filter((value) => value !== day) : [...editor.recurrenceWeekdays, day] })} disabled={busy} />{label}</label>)}</div>}
          </fieldset>}

          {people.length > 0 && <fieldset className="calendar-editor-section">
            <legend>People</legend>
            <div className="calendar-person-picker">{people.map((person) => <label key={person.id}><input type="checkbox" checked={editor.personIds.includes(person.id)} onChange={() => setEditor({ ...editor, personIds: editor.personIds.includes(person.id) ? editor.personIds.filter((id) => id !== person.id) : [...editor.personIds, person.id] })} disabled={busy} />{person.displayName}</label>)}</div>
          </fieldset>}

          <fieldset className="calendar-editor-section">
            <legend>Reminders</legend>
            <div className="calendar-reminder-picker">
              {[{ minutes: 30, label: "30 minutes before" }, { minutes: 60, label: "1 hour before" }].map((choice) => <label key={choice.minutes}><input type="checkbox" checked={editor.reminderMinutes.includes(choice.minutes)} onChange={() => setEditor({ ...editor, reminderMinutes: editor.reminderMinutes.includes(choice.minutes) ? editor.reminderMinutes.filter((minutes) => minutes !== choice.minutes) : [...editor.reminderMinutes, choice.minutes] })} disabled={busy} />{choice.label}</label>)}
            </div>
          </fieldset>

          <fieldset className="calendar-editor-section">
            <legend>Transportation</legend>
            <label>Plan<select value={editor.transportMode} onChange={(e) => setEditor({ ...editor, transportMode: e.target.value as CalendarTransportMode })} disabled={busy}><option value="none">None</option><option value="self">Self / no coordination needed</option><option value="pickup">Pickup</option><option value="dropoff">Drop-off</option><option value="round-trip">Pickup and drop-off</option></select></label>
            {(editor.transportMode === "pickup" || editor.transportMode === "round-trip") && <label>Pickup by<select value={editor.pickupPersonId} onChange={(e) => setEditor({ ...editor, pickupPersonId: e.target.value })} disabled={busy} required><option value="">Choose person</option>{people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>}
            {(editor.transportMode === "dropoff" || editor.transportMode === "round-trip") && <label>Drop-off by<select value={editor.dropoffPersonId} onChange={(e) => setEditor({ ...editor, dropoffPersonId: e.target.value })} disabled={busy} required><option value="">Choose person</option>{people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>}
            {editor.transportMode !== "none" && <label>Transportation notes<input type="text" value={editor.transportNotes} maxLength={1000} onChange={(e) => setEditor({ ...editor, transportNotes: e.target.value })} disabled={busy} /></label>}
          </fieldset>

          <div className="calendar-form-row">
            <label>Location<input type="text" value={editor.location} maxLength={240} onChange={(e) => setEditor({ ...editor, location: e.target.value })} disabled={busy} /></label>
            <label>Notes<textarea value={editor.notes} maxLength={5000} rows={4} onChange={(e) => setEditor({ ...editor, notes: e.target.value })} disabled={busy} /></label>
          </div>
          <div className="editor-actions">
            {editor.kind === "edit" && editor.event && (confirmDelete
              ? <div className="delete-confirm"><span>{editor.editScope === "occurrence" ? "Skip this occurrence?" : editor.seriesEvent?.recurrence ? "Delete the entire series?" : "Delete this event?"}</span><button className="danger-button" type="button" onClick={() => void deleteEditorEvent()} disabled={busy}>{editor.editScope === "occurrence" ? "Skip occurrence" : "Delete"}</button><button className="quiet-button" type="button" onClick={() => setConfirmDelete(false)} disabled={busy}>Cancel</button></div>
              : <button className="danger-link" type="button" onClick={() => setConfirmDelete(true)} disabled={busy}>{editor.editScope === "occurrence" ? "Skip this occurrence" : editor.seriesEvent?.recurrence ? "Delete series" : "Delete event"}</button>)}
            <button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : canSync ? "Save" : "Save offline"}</button>
          </div>
        </form>
      </section>
    </div>}

  </section>;
}
