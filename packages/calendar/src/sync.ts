import type {
  HomiModuleMutationAdapter,
  HomiModuleMutationSubmissionResult,
  HomiModuleQueuedMutation,
  HomiModuleSyncChange,
  HomiModuleSyncChangeHandler,
  HomiModuleSyncHandlerContext,
} from "@homi/module-sdk";
import { CALENDAR_MODULE_KEY } from "./constants.js";
import { CALENDAR_COLORS } from "./settings.js";
import type { CalendarEvent } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE = /^[1-9][0-9]*$/;
const NON_NEGATIVE = /^(0|[1-9][0-9]*)$/;

export class CalendarWebApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly requestId?: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "CalendarWebApiError";
  }
}

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new CalendarWebApiError(
      "CALENDAR_API_INVALID_RESPONSE",
      "Calendar returned an invalid JSON response.",
      response.status,
      undefined,
      { cause },
    );
  }
}

function responseError(
  body: unknown,
  status: number,
): CalendarWebApiError {
  if (
    isObject(body) &&
    isObject(body.error) &&
    typeof body.error.code === "string" &&
    typeof body.error.message === "string"
  ) {
    return new CalendarWebApiError(
      body.error.code,
      body.error.message,
      status,
      typeof body.error.requestId === "string"
        ? body.error.requestId
        : undefined,
    );
  }
  return new CalendarWebApiError(
    "CALENDAR_API_FAILED",
    "The Calendar request failed.",
    status,
  );
}

function parseMutationResult(
  body: unknown,
  clientMutationId: string,
): HomiModuleMutationSubmissionResult {
  if (!isObject(body) || !isObject(body.data)) {
    throw new CalendarWebApiError(
      "CALENDAR_MUTATION_INVALID_RESPONSE",
      "The Calendar mutation response is invalid.",
    );
  }
  const data = body.data;
  if (
    data.clientMutationId !== clientMutationId ||
    (data.status !== "received" &&
      data.status !== "applied" &&
      data.status !== "conflict" &&
      data.status !== "rejected") ||
    !(
      data.serverRevision === null ||
      (typeof data.serverRevision === "string" &&
        POSITIVE.test(data.serverRevision))
    ) ||
    !(
      data.changeSequence === null ||
      (typeof data.changeSequence === "string" &&
        NON_NEGATIVE.test(data.changeSequence))
    ) ||
    !(
      data.errorCode === null ||
      typeof data.errorCode === "string"
    ) ||
    typeof data.replayed !== "boolean"
  ) {
    throw new CalendarWebApiError(
      "CALENDAR_MUTATION_INVALID_RESPONSE",
      "The Calendar mutation response data is invalid.",
    );
  }
  return Object.freeze({
    clientMutationId: data.clientMutationId,
    status: data.status,
    serverRevision: data.serverRevision,
    changeSequence: data.changeSequence,
    errorCode: data.errorCode,
    serverState: data.serverState,
    replayed: data.replayed,
  });
}

export function parseCalendarEvent(
  value: unknown,
): CalendarEvent {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    !UUID.test(value.id) ||
    typeof value.householdId !== "string" ||
    !UUID.test(value.householdId) ||
    typeof value.calendarId !== "string" ||
    !UUID.test(value.calendarId) ||
    typeof value.color !== "string" ||
    !Object.hasOwn(CALENDAR_COLORS, value.color) ||
    typeof value.title !== "string" ||
    typeof value.allDay !== "boolean" ||
    typeof value.timeZone !== "string" ||
    typeof value.revision !== "string" ||
    !POSITIVE.test(value.revision) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !Array.isArray(value.personIds) ||
    !Array.isArray(value.reminderMinutes) ||
    !Array.isArray(value.recurrenceOverrides) ||
    !isObject(value.transport)
  ) {
    throw new CalendarWebApiError(
      "CALENDAR_EVENT_INVALID_RESPONSE",
      "The Calendar event response is invalid.",
    );
  }
  return Object.freeze(value as unknown as CalendarEvent);
}

const CALENDAR_SYNC_OPERATIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  event: Object.freeze(["create", "update", "delete"]),
  "calendar-layer": Object.freeze(["create", "update", "delete"]),
  "calendar-settings": Object.freeze(["update"]),
});

async function submitCalendarMutation(
  mutation: HomiModuleQueuedMutation,
  clientId: string,
  signal?: AbortSignal,
): Promise<HomiModuleMutationSubmissionResult> {
  if (
    mutation.moduleKey !== CALENDAR_MODULE_KEY ||
    !CALENDAR_SYNC_OPERATIONS[mutation.entityType]?.includes(
      mutation.operation,
    ) ||
    !UUID.test(mutation.householdId) ||
    !UUID.test(mutation.entityId) ||
    !UUID.test(mutation.clientMutationId) ||
    !UUID.test(clientId) ||
    !NON_NEGATIVE.test(mutation.baseRevision)
  ) {
    throw new CalendarWebApiError(
      "CALENDAR_MUTATION_INVALID_INPUT",
      "The queued Calendar mutation is invalid.",
    );
  }

  const response = await fetch(
    "/api/v1/core/sync/mutations",
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Homi-Household-ID": mutation.householdId,
        "X-Homi-Client-ID": clientId,
      },
      body: JSON.stringify({
        clientMutationId: mutation.clientMutationId,
        moduleKey: mutation.moduleKey,
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        operation: mutation.operation,
        baseRevision: mutation.baseRevision,
        payload: mutation.payload,
      }),
      ...(signal ? { signal } : {}),
    },
  );
  const body = await readJson(response);
  if (!response.ok) throw responseError(body, response.status);
  return parseMutationResult(
    body,
    mutation.clientMutationId,
  );
}

async function fetchEvent(
  change: HomiModuleSyncChange,
  context: HomiModuleSyncHandlerContext,
  signal?: AbortSignal,
): Promise<CalendarEvent> {
  const response = await fetch(
    `/api/v1/modules/calendar/events/${encodeURIComponent(
      change.entityId,
    )}`,
    {
      method: "GET",
      credentials: "same-origin",
      headers: {
        "X-Homi-Household-ID": context.householdId,
        "X-Homi-Client-ID": context.clientId,
      },
      ...(signal ? { signal } : {}),
    },
  );
  const body = await readJson(response);
  if (!response.ok) throw responseError(body, response.status);
  if (!isObject(body) || !Object.hasOwn(body, "data")) {
    throw new CalendarWebApiError(
      "CALENDAR_EVENT_INVALID_RESPONSE",
      "The Calendar event response shape is invalid.",
    );
  }
  const event = parseCalendarEvent(body.data);
  if (
    event.id !== change.entityId ||
    BigInt(event.revision) < BigInt(change.revision)
  ) {
    throw new CalendarWebApiError(
      "CALENDAR_EVENT_STALE_RESPONSE",
      "The Calendar event snapshot is older than the sync change.",
    );
  }
  return event;
}

function parseCalendarLayerSnapshot(value: unknown) {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    !UUID.test(value.id) ||
    typeof value.householdId !== "string" ||
    !UUID.test(value.householdId) ||
    typeof value.name !== "string" ||
    typeof value.color !== "string" ||
    (value.kind !== "local" && value.kind !== "external") ||
    typeof value.revision !== "string" ||
    !POSITIVE.test(value.revision) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new CalendarWebApiError(
      "CALENDAR_LAYER_INVALID_RESPONSE",
      "The Calendar layer response is invalid.",
    );
  }
  return Object.freeze({ ...value });
}

function parseCalendarSettingsSnapshot(value: unknown) {
  if (
    !isObject(value) ||
    value.state !== "configured" ||
    !["day", "week", "month", "upcoming"].includes(String(value.defaultView)) ||
    !["sunday", "monday"].includes(String(value.weekStart)) ||
    typeof value.timeZone !== "string" ||
    !["none", "30m", "1h"].includes(String(value.defaultReminder)) ||
    typeof value.defaultCalendarId !== "string" ||
    !UUID.test(value.defaultCalendarId) ||
    typeof value.revision !== "string" ||
    !POSITIVE.test(value.revision)
  ) {
    throw new CalendarWebApiError(
      "CALENDAR_SETTINGS_INVALID_RESPONSE",
      "The Calendar settings response is invalid.",
    );
  }
  return Object.freeze({ ...value });
}

async function fetchLayer(
  change: HomiModuleSyncChange,
  context: HomiModuleSyncHandlerContext,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api/v1/modules/calendar/calendars/${encodeURIComponent(change.entityId)}`,
    {
      credentials: "same-origin",
      headers: {
        "X-Homi-Household-ID": context.householdId,
        "X-Homi-Client-ID": context.clientId,
      },
      ...(signal ? { signal } : {}),
    },
  );
  const body = await readJson(response);
  if (!response.ok) throw responseError(body, response.status);
  if (!isObject(body) || !Object.hasOwn(body, "data")) {
    throw new CalendarWebApiError(
      "CALENDAR_LAYER_INVALID_RESPONSE",
      "The Calendar layer response shape is invalid.",
    );
  }
  const layer = parseCalendarLayerSnapshot(body.data);
  if (
    layer.id !== change.entityId ||
    BigInt(String(layer.revision)) < BigInt(change.revision)
  ) {
    throw new CalendarWebApiError(
      "CALENDAR_LAYER_STALE_RESPONSE",
      "The Calendar layer snapshot is older than the sync change.",
    );
  }
  return layer;
}

async function fetchSettings(
  change: HomiModuleSyncChange,
  context: HomiModuleSyncHandlerContext,
  signal?: AbortSignal,
) {
  const response = await fetch(
    "/api/v1/modules/calendar/setup",
    {
      credentials: "same-origin",
      headers: {
        "X-Homi-Household-ID": context.householdId,
        "X-Homi-Client-ID": context.clientId,
      },
      ...(signal ? { signal } : {}),
    },
  );
  const body = await readJson(response);
  if (!response.ok) throw responseError(body, response.status);
  if (!isObject(body) || !Object.hasOwn(body, "data")) {
    throw new CalendarWebApiError(
      "CALENDAR_SETTINGS_INVALID_RESPONSE",
      "The Calendar settings response shape is invalid.",
    );
  }
  const settings = parseCalendarSettingsSnapshot(body.data);
  if (BigInt(String(settings.revision)) < BigInt(change.revision)) {
    throw new CalendarWebApiError(
      "CALENDAR_SETTINGS_STALE_RESPONSE",
      "The Calendar settings snapshot is older than the sync change.",
    );
  }
  return settings;
}

export const calendarEventMutationAdapter:
  HomiModuleMutationAdapter = Object.freeze({
    moduleKey: CALENDAR_MODULE_KEY,
    entityType: "event",
    operations: Object.freeze([
      "create",
      "update",
      "delete",
    ]),
    submit: submitCalendarMutation,
  });

export const calendarEventChangeHandler:
  HomiModuleSyncChangeHandler = Object.freeze({
    moduleKey: CALENDAR_MODULE_KEY,
    entityType: "event",
    async materialize(
      change: HomiModuleSyncChange,
      context: HomiModuleSyncHandlerContext,
      signal?: AbortSignal,
    ) {
      if (
        change.moduleKey !== CALENDAR_MODULE_KEY ||
        change.entityType !== "event" ||
        change.householdId !== context.householdId
      ) {
        throw new CalendarWebApiError(
          "CALENDAR_CHANGE_INVALID",
          "The Calendar change does not match the active household.",
        );
      }
      if (change.operation === "delete") {
        return Object.freeze({
          kind: "delete" as const,
          moduleKey: CALENDAR_MODULE_KEY,
          entityType: "event",
          entityId: change.entityId,
          sequence: change.sequence,
        });
      }
      if (
        change.operation !== "create" &&
        change.operation !== "update"
      ) {
        throw new CalendarWebApiError(
          "CALENDAR_CHANGE_INVALID",
          "The Calendar change operation is unsupported.",
        );
      }
      const event = await fetchEvent(
        change,
        context,
        signal,
      );
      return Object.freeze({
        kind: "put" as const,
        moduleKey: CALENDAR_MODULE_KEY,
        entityType: "event",
        entityId: event.id,
        revision: event.revision,
        sequence: change.sequence,
        data: event,
      });
    },
  });


export const calendarLayerMutationAdapter:
  HomiModuleMutationAdapter = Object.freeze({
    moduleKey: CALENDAR_MODULE_KEY,
    entityType: "calendar-layer",
    operations: Object.freeze(["create", "update", "delete"]),
    submit: submitCalendarMutation,
  });

export const calendarSettingsMutationAdapter:
  HomiModuleMutationAdapter = Object.freeze({
    moduleKey: CALENDAR_MODULE_KEY,
    entityType: "calendar-settings",
    operations: Object.freeze(["update"]),
    submit: submitCalendarMutation,
  });

export const legacyCalendarLayerMutationAdapter:
  HomiModuleMutationAdapter = Object.freeze({
    moduleKey: CALENDAR_MODULE_KEY,
    entityType: "calendar",
    operations: Object.freeze(["create", "update", "delete"]),
    submit: submitCalendarMutation,
  });

export const legacyCalendarSettingsMutationAdapter:
  HomiModuleMutationAdapter = Object.freeze({
    moduleKey: CALENDAR_MODULE_KEY,
    entityType: "settings",
    operations: Object.freeze(["create", "update"]),
    submit: submitCalendarMutation,
  });

export const calendarLayerChangeHandler:
  HomiModuleSyncChangeHandler = Object.freeze({
    moduleKey: CALENDAR_MODULE_KEY,
    entityType: "calendar-layer",
    async materialize(
      change: HomiModuleSyncChange,
      context: HomiModuleSyncHandlerContext,
      signal?: AbortSignal,
    ) {
      if (
        change.moduleKey !== CALENDAR_MODULE_KEY ||
        change.entityType !== "calendar-layer" ||
        change.householdId !== context.householdId
      ) {
        throw new CalendarWebApiError(
          "CALENDAR_CHANGE_INVALID",
          "The Calendar layer change does not match the active household.",
        );
      }
      if (change.operation === "delete") {
        return Object.freeze({
          kind: "delete" as const,
          moduleKey: CALENDAR_MODULE_KEY,
          entityType: "calendar-layer",
          entityId: change.entityId,
          sequence: change.sequence,
        });
      }
      const layer = await fetchLayer(change, context, signal);
      return Object.freeze({
        kind: "put" as const,
        moduleKey: CALENDAR_MODULE_KEY,
        entityType: "calendar-layer",
        entityId: change.entityId,
        revision: String(layer.revision),
        sequence: change.sequence,
        data: layer,
      });
    },
  });

export const legacyCalendarLayerChangeHandler:
  HomiModuleSyncChangeHandler = Object.freeze({
    moduleKey: CALENDAR_MODULE_KEY,
    entityType: "calendar",
    async materialize(
      change: HomiModuleSyncChange,
      context: HomiModuleSyncHandlerContext,
      signal?: AbortSignal,
    ) {
      if (
        change.moduleKey !== CALENDAR_MODULE_KEY ||
        change.entityType !== "calendar" ||
        change.householdId !== context.householdId
      ) {
        throw new CalendarWebApiError(
          "CALENDAR_CHANGE_INVALID",
          "The legacy Calendar layer change does not match the active household.",
        );
      }
      if (change.operation === "delete") {
        return Object.freeze({
          kind: "delete" as const,
          moduleKey: CALENDAR_MODULE_KEY,
          entityType: "calendar",
          entityId: change.entityId,
          sequence: change.sequence,
        });
      }
      const layer = await fetchLayer(change, context, signal);
      return Object.freeze({
        kind: "put" as const,
        moduleKey: CALENDAR_MODULE_KEY,
        entityType: "calendar",
        entityId: change.entityId,
        revision: String(layer.revision),
        sequence: change.sequence,
        data: layer,
      });
    },
  });

export const calendarSettingsChangeHandler:
  HomiModuleSyncChangeHandler = Object.freeze({
    moduleKey: CALENDAR_MODULE_KEY,
    entityType: "calendar-settings",
    async materialize(
      change: HomiModuleSyncChange,
      context: HomiModuleSyncHandlerContext,
      signal?: AbortSignal,
    ) {
      if (
        change.moduleKey !== CALENDAR_MODULE_KEY ||
        change.entityType !== "calendar-settings" ||
        change.householdId !== context.householdId ||
        change.operation !== "update"
      ) {
        throw new CalendarWebApiError(
          "CALENDAR_CHANGE_INVALID",
          "The Calendar settings change does not match the active household.",
        );
      }
      const settings = await fetchSettings(change, context, signal);
      return Object.freeze({
        kind: "put" as const,
        moduleKey: CALENDAR_MODULE_KEY,
        entityType: "calendar-settings",
        entityId: change.entityId,
        revision: String(settings.revision),
        sequence: change.sequence,
        data: settings,
      });
    },
  });

export const legacyCalendarSettingsChangeHandler:
  HomiModuleSyncChangeHandler = Object.freeze({
    moduleKey: CALENDAR_MODULE_KEY,
    entityType: "settings",
    async materialize(
      change: HomiModuleSyncChange,
      context: HomiModuleSyncHandlerContext,
      signal?: AbortSignal,
    ) {
      if (
        change.moduleKey !== CALENDAR_MODULE_KEY ||
        change.entityType !== "settings" ||
        change.householdId !== context.householdId ||
        (change.operation !== "create" && change.operation !== "update")
      ) {
        throw new CalendarWebApiError(
          "CALENDAR_CHANGE_INVALID",
          "The legacy Calendar settings change does not match the active household.",
        );
      }
      const settings = await fetchSettings(change, context, signal);
      return Object.freeze({
        kind: "put" as const,
        moduleKey: CALENDAR_MODULE_KEY,
        entityType: "settings",
        entityId: change.entityId,
        revision: String(settings.revision),
        sequence: change.sequence,
        data: settings,
      });
    },
  });
