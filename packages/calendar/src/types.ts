import type { CalendarColor } from "./settings.js";

export const HOMI_CALENDAR_MODULE_KEY = "calendar" as const;
export const HOMI_CALENDAR_VERSION = "0.6.10" as const;

export type CalendarRecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

export interface CalendarRecurrenceRule {
  frequency: CalendarRecurrenceFrequency;
  interval: number;
  /** Sunday = 0 ... Saturday = 6. Used only by weekly recurrence. */
  weekdays: readonly number[];
  /** Inclusive local calendar date. null means no explicit series end. */
  endDate: string | null;
}

export type CalendarTransportMode =
  | "none"
  | "self"
  | "pickup"
  | "dropoff"
  | "round-trip";

export interface CalendarTransportContext {
  mode: CalendarTransportMode;
  pickupPersonId: string | null;
  dropoffPersonId: string | null;
  notes: string | null;
}

export interface CalendarOccurrenceReplacement {
  calendarId: string;
  color: CalendarColor;
  title: string;
  description: string | null;
  allDay: boolean;
  timeZone: string;
  startsAt: string | null;
  endsAt: string | null;
  startDate: string | null;
  endDateExclusive: string | null;
  location: string | null;
  notes: string | null;
  personIds: readonly string[];
  reminderMinutes: readonly number[];
  transport: CalendarTransportContext;
}

export interface CalendarOccurrenceOverride {
  /** Original occurrence local date; this is the stable recurrence identity. */
  occurrenceDate: string;
  action: "skip" | "replace";
  replacement: CalendarOccurrenceReplacement | null;
}

export interface CalendarEvent {
  id: string;
  householdId: string;
  calendarId: string;
  color: CalendarColor;
  title: string;
  description: string | null;
  allDay: boolean;
  timeZone: string;
  startsAt: string | null;
  endsAt: string | null;
  startDate: string | null;
  endDateExclusive: string | null;
  location: string | null;
  notes: string | null;
  recurrence: CalendarRecurrenceRule | null;
  recurrenceOverrides: readonly CalendarOccurrenceOverride[];
  personIds: readonly string[];
  reminderMinutes: readonly number[];
  transport: CalendarTransportContext;
  source: "local" | "external";
  externalProvider: "google" | "apple" | "outlook" | null;
  externalConnectionId: string | null;
  remoteEventId: string | null;
  revision: string;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEventPayload {
  calendarId?: string;
  color?: CalendarColor;
  title?: string;
  description?: string | null;
  allDay?: boolean;
  timeZone?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  startDate?: string | null;
  endDateExclusive?: string | null;
  location?: string | null;
  notes?: string | null;
  recurrence?: CalendarRecurrenceRule | null;
  recurrenceOverrides?: readonly CalendarOccurrenceOverride[];
  personIds?: readonly string[];
  reminderMinutes?: readonly number[];
  transport?: CalendarTransportContext;
}

export interface CalendarOccurrence {
  occurrenceId: string;
  seriesEventId: string;
  occurrenceDate: string;
  recurring: boolean;
  overridden: boolean;
  event: CalendarOccurrenceReplacement;
}

export interface CalendarPerson {
  id: string;
  displayName: string;
  avatarFileId: string | null;
}

export interface CalendarSearchResult {
  event: CalendarEvent;
  matchedPeople: readonly CalendarPerson[];
}

export interface CalendarMutationInput {
  clientMutationId: string;
  moduleKey: "calendar";
  entityType: "event";
  entityId: string;
  operation: "create" | "update" | "delete";
  baseRevision: bigint;
  payload: CalendarEventPayload;
}

export interface CalendarMutationResult {
  clientMutationId: string;
  status: "received" | "applied" | "conflict" | "rejected";
  serverRevision: string | null;
  changeSequence: string | null;
  errorCode: string | null;
  serverState: CalendarEvent | null;
  replayed: boolean;
}

export interface CalendarEventRange {
  from: Date;
  to: Date;
}
