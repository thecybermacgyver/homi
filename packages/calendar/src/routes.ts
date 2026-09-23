import type { FastifyInstance, FastifyRequest } from "fastify";
import type { HomiRequestContext } from "@homi/module-sdk";
import {
  isCalendarLayerCreate,
  isCalendarLayerDelete,
  isCalendarLayerUpdate,
} from "./calendars.js";
import { parseEventPayload } from "./event-validation.js";
import { isCalendarSettingsWrite } from "./settings.js";
import type { CalendarService } from "./service.js";
import type { CalendarEventPayload, CalendarMutationInput } from "./types.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CalendarRouteDependencies {
  calendar: CalendarService;
  resolveContext(request: {
    id: string;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<HomiRequestContext>;
}

function validationError(message: string): never {
  const error = new Error(message) as Error & {
    statusCode: number;
    code: string;
  };
  error.statusCode = 400;
  error.code = "VALIDATION_FAILED";
  throw error;
}

function validDate(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    validationError(field + " must be an ISO date-time with a time-zone offset.");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    validationError(field + " must be a valid date-time.");
  }
  return parsed.toISOString();
}

function parsePayload(
  value: unknown,
  operation: "create" | "update" | "delete",
): CalendarEventPayload {
  try {
    return parseEventPayload(value, operation);
  } catch (error) {
    validationError(error instanceof Error ? error.message : "Invalid Calendar event payload.");
  }
}

function parseMutation(body: unknown): CalendarMutationInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    validationError("A JSON object is required.");
  }

  const source = body as Record<string, unknown>;
  const requiredKeys = [
    "clientMutationId",
    "moduleKey",
    "entityType",
    "entityId",
    "operation",
    "baseRevision",
    "payload",
  ];
  if (
    Object.keys(source).length !== requiredKeys.length ||
    !requiredKeys.every((key) => Object.hasOwn(source, key))
  ) {
    validationError("The Calendar mutation envelope is invalid.");
  }

  if (
    typeof source.clientMutationId !== "string" ||
    !UUID_PATTERN.test(source.clientMutationId)
  ) {
    validationError("clientMutationId must be a valid UUID.");
  }
  if (source.moduleKey !== "calendar" || source.entityType !== "event") {
    validationError("Calendar only accepts calendar/event mutations.");
  }
  if (typeof source.entityId !== "string" || !UUID_PATTERN.test(source.entityId)) {
    validationError("entityId must be a valid UUID.");
  }
  if (
    source.operation !== "create" &&
    source.operation !== "update" &&
    source.operation !== "delete"
  ) {
    validationError("operation must be create, update or delete.");
  }
  if (
    typeof source.baseRevision !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(source.baseRevision)
  ) {
    validationError("baseRevision must be a non-negative integer string.");
  }
  if (source.operation === "create" && source.baseRevision !== "0") {
    validationError("Create mutations require baseRevision 0.");
  }
  if (source.operation !== "create" && !/^[1-9][0-9]*$/.test(source.baseRevision)) {
    validationError("Update/delete mutations require a positive baseRevision.");
  }

  return {
    clientMutationId: source.clientMutationId,
    moduleKey: "calendar",
    entityType: "event",
    entityId: source.entityId,
    operation: source.operation,
    baseRevision: BigInt(source.baseRevision),
    payload: parsePayload(source.payload, source.operation),
  };
}

function contextFor(
  request: FastifyRequest,
  dependencies: CalendarRouteDependencies,
): Promise<HomiRequestContext> {
  return dependencies.resolveContext({
    id: request.id,
    headers: request.headers,
  });
}

function calendarIdFrom(request: FastifyRequest): string {
  const params = request.params as { calendarId?: unknown };
  if (typeof params.calendarId !== "string" || !UUID_PATTERN.test(params.calendarId)) {
    validationError("calendarId must be a valid UUID.");
  }
  return params.calendarId;
}

export function registerCalendarRoutes(
  app: FastifyInstance,
  dependencies: CalendarRouteDependencies,
): void {
  app.get("/api/v1/modules/calendar/calendars", async (request, reply) => {
    const context = await contextFor(request, dependencies);
    reply.header("Cache-Control", "no-store");
    return { data: { calendars: await dependencies.calendar.listCalendars(context) } };
  });

  app.get("/api/v1/modules/calendar/calendars/:calendarId", async (request, reply) => {
    const context = await contextFor(request, dependencies);
    const calendarId = calendarIdFrom(request);
    reply.header("Cache-Control", "no-store");
    return { data: await dependencies.calendar.getCalendar(context, calendarId) };
  });

  app.post("/api/v1/modules/calendar/calendars", async (request, reply) => {
    if (!isCalendarLayerCreate(request.body)) {
      validationError("Invalid Calendar create contract.");
    }
    const context = await contextFor(request, dependencies);
    reply.header("Cache-Control", "no-store");
    return { data: await dependencies.calendar.createCalendar(context, request.body) };
  });

  app.put("/api/v1/modules/calendar/calendars/:calendarId", async (request, reply) => {
    if (!isCalendarLayerUpdate(request.body)) {
      validationError("Invalid Calendar update contract.");
    }
    const context = await contextFor(request, dependencies);
    const calendarId = calendarIdFrom(request);
    reply.header("Cache-Control", "no-store");
    return { data: await dependencies.calendar.updateCalendar(context, calendarId, request.body) };
  });

  app.delete("/api/v1/modules/calendar/calendars/:calendarId", async (request, reply) => {
    if (!isCalendarLayerDelete(request.body)) {
      validationError("Invalid Calendar delete contract.");
    }
    const context = await contextFor(request, dependencies);
    const calendarId = calendarIdFrom(request);
    reply.header("Cache-Control", "no-store");
    return { data: await dependencies.calendar.deleteCalendar(context, calendarId, request.body) };
  });

  app.get("/api/v1/modules/calendar/settings", async (request, reply) => {
    const context = await contextFor(request, dependencies);
    reply.header("Cache-Control", "no-store");
    return { data: await dependencies.calendar.getSettings(context) };
  });

  app.put("/api/v1/modules/calendar/settings", async (request, reply) => {
    if (!isCalendarSettingsWrite(request.body)) {
      validationError("Invalid Calendar settings contract.");
    }
    const context = await contextFor(request, dependencies);
    reply.header("Cache-Control", "no-store");
    return { data: await dependencies.calendar.saveSettings(context, request.body) };
  });

  app.get("/api/v1/modules/calendar/people", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    if (Object.keys(query).length !== 0) validationError("Calendar people does not accept query parameters.");
    const context = await contextFor(request, dependencies);
    reply.header("Cache-Control", "no-store");
    return { data: { people: await dependencies.calendar.listPeople(context) } };
  });

  app.get("/api/v1/modules/calendar/search", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const keys = Object.keys(query);
    if (keys.some((key) => key !== "q" && key !== "limit") || !keys.includes("q")) {
      validationError("Calendar search accepts q and optional limit only.");
    }
    if (typeof query.q !== "string" || query.q.trim().length < 1 || query.q.trim().length > 200) {
      validationError("Calendar search q must contain 1 to 200 characters.");
    }
    const rawLimit = query.limit === undefined ? "50" : query.limit;
    if (typeof rawLimit !== "string" || !/^[1-9][0-9]*$/.test(rawLimit)) {
      validationError("Calendar search limit must be an integer from 1 to 100.");
    }
    const limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      validationError("Calendar search limit must be an integer from 1 to 100.");
    }
    const context = await contextFor(request, dependencies);
    reply.header("Cache-Control", "no-store");
    return { data: { results: await dependencies.calendar.searchEvents(context, query.q.trim(), limit) } };
  });

  app.get("/api/v1/modules/calendar/events", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const keys = Object.keys(query);
    if (keys.length !== 2 || !keys.includes("from") || !keys.includes("to")) {
      validationError("Calendar range queries require only from and to.");
    }
    const from = new Date(validDate(query.from, "from"));
    const to = new Date(validDate(query.to, "to"));
    if (
      to.getTime() <= from.getTime() ||
      to.getTime() - from.getTime() > 370 * 24 * 60 * 60 * 1000
    ) {
      validationError("Calendar range must be positive and at most 370 days.");
    }
    const context = await contextFor(request, dependencies);
    reply.header("Cache-Control", "no-store");
    return { data: { events: await dependencies.calendar.listEvents(context, { from, to }) } };
  });

  app.get("/api/v1/modules/calendar/events/:eventId", async (request, reply) => {
    const params = request.params as { eventId?: unknown };
    if (typeof params.eventId !== "string" || !UUID_PATTERN.test(params.eventId)) {
      validationError("eventId must be a valid UUID.");
    }
    const context = await contextFor(request, dependencies);
    reply.header("Cache-Control", "no-store");
    return { data: await dependencies.calendar.getEvent(context, params.eventId) };
  });

  app.post("/api/v1/modules/calendar/mutations", async (request) => {
    const context = await contextFor(request, dependencies);
    return { data: await dependencies.calendar.applyMutation(context, parseMutation(request.body)) };
  });
}
