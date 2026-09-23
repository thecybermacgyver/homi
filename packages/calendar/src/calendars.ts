import {
  CALENDAR_COLORS,
  exactSettingsObject,
  isCalendarUuid,
  type CalendarColor,
} from './settings.js';

export interface CalendarLayer {
  id: string;
  householdId: string;
  name: string;
  color: CalendarColor;
  kind: 'local';
  revision: string;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarLayerCreate {
  id: string;
  name: string;
  color: CalendarColor;
}

export interface CalendarLayerUpdate {
  baseRevision: string;
  name: string;
  color: CalendarColor;
}

export interface CalendarLayerDelete {
  baseRevision: string;
}

export interface CalendarLayerWriteResult {
  status: 'saved' | 'conflict';
  calendar: CalendarLayer;
}

export interface CalendarLayerDeleteResult {
  status: 'deleted' | 'conflict';
  calendar: CalendarLayer;
}

function validRevision(value: unknown, allowZero = false): value is string {
  return typeof value === 'string'
    && (allowZero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(value)
    && BigInt(value) <= 9223372036854775807n;
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 200;
}

function validColor(value: unknown): value is CalendarColor {
  return typeof value === 'string' && Object.hasOwn(CALENDAR_COLORS, value);
}

export function isCalendarLayer(value: unknown, householdId?: string): value is CalendarLayer {
  if (!exactSettingsObject(value, [
    'id', 'householdId', 'name', 'color', 'kind', 'revision', 'createdAt', 'updatedAt',
  ])) return false;
  return isCalendarUuid(value.id)
    && isCalendarUuid(value.householdId)
    && (householdId === undefined || value.householdId === householdId)
    && validName(value.name)
    && validColor(value.color)
    && value.kind === 'local'
    && validRevision(value.revision)
    && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
    && typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt));
}

export function isCalendarLayerCreate(value: unknown): value is CalendarLayerCreate {
  return exactSettingsObject(value, ['id', 'name', 'color'])
    && isCalendarUuid(value.id) && validName(value.name) && validColor(value.color);
}

export function isCalendarLayerUpdate(value: unknown): value is CalendarLayerUpdate {
  return exactSettingsObject(value, ['baseRevision', 'name', 'color'])
    && validRevision(value.baseRevision) && validName(value.name) && validColor(value.color);
}

export function isCalendarLayerDelete(value: unknown): value is CalendarLayerDelete {
  return exactSettingsObject(value, ['baseRevision']) && validRevision(value.baseRevision);
}
