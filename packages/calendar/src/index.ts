export {
  HOMI_CALENDAR_MODULE_KEY,
  HOMI_CALENDAR_VERSION,
  type CalendarEvent,
  type CalendarEventPayload,
  type CalendarRecurrenceFrequency,
  type CalendarRecurrenceRule,
  type CalendarOccurrenceOverride,
  type CalendarOccurrenceReplacement,
  type CalendarOccurrence,
  type CalendarTransportMode,
  type CalendarTransportContext,
  type CalendarPerson,
  type CalendarSearchResult,
  type CalendarEventRange,
  type CalendarMutationInput,
  type CalendarMutationResult,
} from "./types.js";

export {
  createCalendarService,
  CalendarServiceError,
  type CalendarService,
} from "./service.js";

export {
  registerCalendarRoutes,
  type CalendarRouteDependencies,
} from "./routes.js";

export {
  calendarSchema,
  calendarCalendars,
  calendarEvents,
  calendarSettings,
} from "./schema.js";

export {
  CALENDAR_COLORS,
  CALENDAR_UUID_PATTERN,
  isCalendarUuid,
  validTimeZone,
  type CalendarColor,
  type CalendarViewName,
  type CalendarPreferences,
  type CalendarSettings,
  type CalendarSettingsWrite,
  type CalendarSettingsResult,
  isCalendarSettings,
  isCalendarSettingsWrite,
  unconfiguredCalendarSettings,
} from "./settings.js";

export {
  type CalendarLayer,
  type CalendarLayerCreate,
  type CalendarLayerUpdate,
  type CalendarLayerDelete,
  type CalendarLayerWriteResult,
  type CalendarLayerDeleteResult,
  isCalendarLayer,
  isCalendarLayerCreate,
  isCalendarLayerUpdate,
  isCalendarLayerDelete,
} from "./calendars.js";

export { expandCalendarEvent, expandCalendarEvents, recurrenceOccursOn } from "./recurrence.js";

export {
  calendarUuid,
  calendarDate,
  calendarInstant,
  validEventTime,
  validReminderMinutes,
  validTransportContext,
  validRecurrenceRule,
  validRecurrenceOverrides,
  parseEventPayload,
} from "./event-validation.js";
