/** Calendar-owned settings contract, shared by server and browser. */
export const CALENDAR_COLORS = {
  red: '#c62828', orange: '#b84d00', yellow: '#927000', lime: '#587c00',
  green: '#287d3c', 'dark green': '#14532d', aqua: '#00796b', cyan: '#007f96',
  blue: '#2563eb', navy: '#203864', purple: '#7139a8', violet: '#6d48c7',
  pink: '#b73773', magenta: '#a21caf', brown: '#795548', black: '#242424',
} as const;
export type CalendarColor = keyof typeof CALENDAR_COLORS;
export type CalendarViewName = 'day' | 'week' | 'month' | 'upcoming';

export const CALENDAR_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCalendarUuid(value: unknown): value is string {
  return typeof value === 'string' && CALENDAR_UUID_PATTERN.test(value);
}

export function validTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export interface CalendarPreferences {
  defaultView: CalendarViewName;
  weekStart: 'sunday' | 'monday';
  timeZone: string;
  defaultReminder: 'none' | '30m' | '1h';
  defaultCalendarId: string;
}
export interface CalendarSettings extends CalendarPreferences {
  householdId: string;
  state: 'unconfigured' | 'configured';
  revision: string;
}
export interface CalendarSettingsWrite extends CalendarPreferences {
  baseRevision: string;
  state: 'unconfigured' | 'configured';
}
export interface CalendarSettingsResult {
  status: 'saved' | 'conflict';
  settings: CalendarSettings;
}
const preferenceKeys = ['defaultView', 'weekStart', 'timeZone', 'defaultReminder', 'defaultCalendarId'];
export function exactSettingsObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function preferences(value: Record<string, unknown>): boolean {
  return ['day', 'week', 'month', 'upcoming'].includes(String(value.defaultView))
    && ['sunday', 'monday'].includes(String(value.weekStart))
    && validTimeZone(value.timeZone)
    && ['none', '30m', '1h'].includes(String(value.defaultReminder))
    && isCalendarUuid(value.defaultCalendarId)
    && (value.state === 'unconfigured' || value.state === 'configured');
}
export function isCalendarSettingsWrite(value: unknown): value is CalendarSettingsWrite {
  return exactSettingsObject(value, [...preferenceKeys, 'baseRevision', 'state'])
    && preferences(value) && typeof value.baseRevision === 'string'
    && /^(0|[1-9][0-9]*)$/.test(value.baseRevision) && BigInt(value.baseRevision) < 9223372036854775807n;
}
export function isCalendarSettings(value: unknown, householdId: string): value is CalendarSettings {
  return exactSettingsObject(value, [...preferenceKeys, 'householdId', 'state', 'revision'])
    && preferences(value) && isCalendarUuid(value.householdId)
    && value.householdId === householdId && typeof value.revision === 'string'
    && /^(0|[1-9][0-9]*)$/.test(value.revision) && BigInt(value.revision) <= 9223372036854775807n
    && (value.state !== 'configured' || value.revision !== '0');
}
export function unconfiguredCalendarSettings(
  householdId: string,
  timeZone: string,
  defaultCalendarId: string,
): CalendarSettings {
  return { householdId, state: 'unconfigured', revision: '0', defaultView: 'week',
    weekStart: 'sunday', timeZone, defaultReminder: '30m', defaultCalendarId };
}
