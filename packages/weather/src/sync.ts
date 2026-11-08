import type {
  HomiModuleMutationAdapter,
  HomiModuleMutationSubmissionResult,
  HomiModuleQueuedMutation,
  HomiModuleSyncChange,
  HomiModuleSyncChangeHandler,
  HomiModuleSyncHandlerContext,
} from "@homi/module-sdk";
import { WEATHER_MODULE_KEY } from "./constants.js";
import type { LinkSite, Place, PrefsRecord, Units } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
const NON_NEGATIVE_INTEGER = /^(0|[1-9][0-9]*)$/;

class WeatherApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "WeatherApiError";
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function json(response: Response): Promise<unknown> {
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new WeatherApiError(
      "WEATHER_API_INVALID_RESPONSE",
      "Weather returned an invalid response.",
      response.status,
    );
  }
}

function responseError(body: unknown, status: number): WeatherApiError {
  if (
    object(body) &&
    object(body.error) &&
    typeof body.error.code === "string" &&
    typeof body.error.message === "string"
  ) {
    return new WeatherApiError(body.error.code, body.error.message, status);
  }
  return new WeatherApiError("WEATHER_API_FAILED", "The Weather request failed.", status);
}

function parseMutationResult(
  body: unknown,
  clientMutationId: string,
): HomiModuleMutationSubmissionResult {
  if (!object(body) || !object(body.data)) {
    throw new WeatherApiError("WEATHER_MUTATION_INVALID_RESPONSE", "The mutation response is invalid.");
  }
  const data = body.data;
  if (
    data.clientMutationId !== clientMutationId ||
    !["received", "applied", "conflict", "rejected"].includes(String(data.status)) ||
    !(data.serverRevision === null || (typeof data.serverRevision === "string" && POSITIVE_INTEGER.test(data.serverRevision))) ||
    !(data.changeSequence === null || (typeof data.changeSequence === "string" && NON_NEGATIVE_INTEGER.test(data.changeSequence))) ||
    !(data.errorCode === null || typeof data.errorCode === "string") ||
    typeof data.replayed !== "boolean"
  ) {
    throw new WeatherApiError("WEATHER_MUTATION_INVALID_RESPONSE", "The mutation response data is invalid.");
  }
  return Object.freeze({
    clientMutationId,
    status: data.status as HomiModuleMutationSubmissionResult["status"],
    serverRevision: data.serverRevision,
    changeSequence: data.changeSequence,
    errorCode: data.errorCode,
    serverState: data.serverState,
    replayed: data.replayed,
  });
}


const ENTITY_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  place: ["create", "update", "delete"],
  preferences: ["create", "update"],
};

async function submit(
  entityType: string,
  mutation: HomiModuleQueuedMutation,
  clientId: string,
  signal?: AbortSignal,
): Promise<HomiModuleMutationSubmissionResult> {
  if (
    mutation.moduleKey !== WEATHER_MODULE_KEY ||
    mutation.entityType !== entityType ||
    !(ENTITY_OPERATIONS[entityType] ?? []).includes(mutation.operation) ||
    !UUID.test(mutation.householdId) ||
    !UUID.test(mutation.entityId) ||
    !UUID.test(mutation.clientMutationId) ||
    !UUID.test(clientId) ||
    !NON_NEGATIVE_INTEGER.test(mutation.baseRevision)
  ) {
    throw new WeatherApiError("WEATHER_MUTATION_INVALID_INPUT", "The queued Weather mutation is invalid.");
  }
  const response = await fetch("/api/v1/core/sync/mutations", {
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
  });
  const body = await json(response);
  if (!response.ok) throw responseError(body, response.status);
  return parseMutationResult(body, mutation.clientMutationId);
}

function adapter(entityType: string): HomiModuleMutationAdapter {
  return Object.freeze({
    moduleKey: WEATHER_MODULE_KEY,
    entityType,
    operations: Object.freeze([...(ENTITY_OPERATIONS[entityType] ?? [])]),
    submit: (mutation: HomiModuleQueuedMutation, clientId: string, signal?: AbortSignal) =>
      submit(entityType, mutation, clientId, signal),
  });
}

interface Parsed { readonly id: string; readonly revision: string; readonly deleted: boolean }

function changeHandler<T extends Parsed>(
  entityType: string,
  path: string,
  parse: (value: unknown) => T,
): HomiModuleSyncChangeHandler {
  async function fetchOne(change: HomiModuleSyncChange, context: HomiModuleSyncHandlerContext, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`/api/v1/modules/weather/${path}/${encodeURIComponent(change.entityId)}`, {
      credentials: "same-origin",
      headers: { "X-Homi-Household-ID": context.householdId, "X-Homi-Client-ID": context.clientId },
      ...(signal ? { signal } : {}),
    });
    const body = await json(response);
    if (!response.ok) throw responseError(body, response.status);
    if (!object(body) || !Object.hasOwn(body, "data")) {
      throw new WeatherApiError("WEATHER_RESPONSE_INVALID", "The Weather response shape is invalid.");
    }
    const value = parse(body.data);
    if (value.id !== change.entityId || BigInt(value.revision) < BigInt(change.revision)) {
      throw new WeatherApiError("WEATHER_RESPONSE_STALE", "The Weather response is stale.");
    }
    return value;
  }
  return Object.freeze({
    moduleKey: WEATHER_MODULE_KEY,
    entityType,
    async materialize(change: HomiModuleSyncChange, context: HomiModuleSyncHandlerContext, signal?: AbortSignal) {
      if (
        change.moduleKey !== WEATHER_MODULE_KEY ||
        change.entityType !== entityType ||
        change.householdId !== context.householdId
      ) {
        throw new WeatherApiError("WEATHER_CHANGE_INVALID", "The Weather sync change is invalid.");
      }
      const gone = () => Object.freeze({
        kind: "delete" as const, moduleKey: WEATHER_MODULE_KEY, entityType,
        entityId: change.entityId, sequence: change.sequence,
      });
      if (change.operation === "delete") return gone();
      if (change.operation !== "create" && change.operation !== "update") {
        throw new WeatherApiError("WEATHER_CHANGE_INVALID", "The Weather sync operation is invalid.");
      }
      // Another member's place or preferences answer "not found" to this member:
      // the change feed names only an id, so such a change is simply dropped.
      let value: T;
      try { value = await fetchOne(change, context, signal); } catch (error) {
        if (error instanceof WeatherApiError && error.status === 404) return gone();
        throw error;
      }
      if (value.deleted) return gone();
      return Object.freeze({
        kind: "put" as const, moduleKey: WEATHER_MODULE_KEY, entityType,
        entityId: value.id, revision: value.revision, sequence: change.sequence, data: value,
      });
    },
  });
}


const LINK_SITES = ["weather.com", "yr.no", "windy"];

function bad(what: string): never {
  throw new WeatherApiError("WEATHER_RESPONSE_INVALID", `A Weather ${what} response is invalid.`);
}

function base(value: unknown, what: string, revisionPattern: RegExp): Record<string, unknown> & { id: string; revision: string; createdAt: string; updatedAt: string; deleted: boolean } {
  if (
    !object(value) || typeof value.id !== "string" || !UUID.test(value.id) ||
    typeof value.revision !== "string" || !revisionPattern.test(value.revision) ||
    typeof value.createdAt !== "string" || typeof value.updatedAt !== "string" || typeof value.deleted !== "boolean"
  ) bad(what);
  return value as never;
}

function parsePlaceValue(value: unknown, revisionPattern: RegExp): Place {
  const v = base(value, "place", revisionPattern);
  if (
    typeof v.name !== "string" || typeof v.region !== "string" || typeof v.country !== "string" ||
    typeof v.latitude !== "number" || typeof v.longitude !== "number" || typeof v.position !== "number" ||
    !(v.cardSlot === null || (typeof v.cardSlot === "number" && Number.isInteger(v.cardSlot) && v.cardSlot >= 1 && v.cardSlot <= 5))
  ) bad("place");
  return Object.freeze({
    id: v.id, name: v.name as string, region: v.region as string, country: v.country as string,
    latitude: v.latitude as number, longitude: v.longitude as number, cardSlot: v.cardSlot as number | null,
    position: v.position as number, revision: v.revision, createdAt: v.createdAt, updatedAt: v.updatedAt, deleted: v.deleted,
  });
}
export function parsePlace(value: unknown): Place { return parsePlaceValue(value, POSITIVE_INTEGER); }
// A place saved on this device has revision 0 and its payload merged in.
export function parseWorkingPlace(value: unknown): Place {
  return parsePlaceValue(object(value) ? { deleted: false, ...value } : value, NON_NEGATIVE_INTEGER);
}

function parsePrefsValue(value: unknown, revisionPattern: RegExp): PrefsRecord {
  const v = base(value, "preferences", revisionPattern);
  if ((v.units !== "metric" && v.units !== "imperial") || !LINK_SITES.includes(String(v.linkSite))) bad("preferences");
  return Object.freeze({
    id: v.id, units: v.units as Units, linkSite: v.linkSite as LinkSite,
    revision: v.revision, createdAt: v.createdAt, updatedAt: v.updatedAt,
  });
}
export function parsePrefs(value: unknown): PrefsRecord {
  return parsePrefsValue(object(value) ? { deleted: false, ...value } : value, POSITIVE_INTEGER);
}
export function parseWorkingPrefs(value: unknown): PrefsRecord {
  return parsePrefsValue(object(value) ? { deleted: false, ...value } : value, NON_NEGATIVE_INTEGER);
}

export const placeMutationAdapter = adapter("place");
export const preferencesMutationAdapter = adapter("preferences");
export const placeChangeHandler = changeHandler("place", "places", parsePlace);
export const preferencesChangeHandler = changeHandler("preferences", "preferences", (value) => {
  const record = parsePrefs(value);
  return { ...record, deleted: false } as PrefsRecord & Parsed;
});
