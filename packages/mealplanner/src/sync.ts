import type {
  HomiModuleMutationAdapter,
  HomiModuleMutationSubmissionResult,
  HomiModuleQueuedMutation,
  HomiModuleSyncChange,
  HomiModuleSyncChangeHandler,
  HomiModuleSyncHandlerContext,
} from "@homi/module-sdk";
import { MEALPLANNER_MODULE_KEY } from "./constants.js";
import type { Idea, Meal, RecipeRef, SettingsRecord, Slot, Kind } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
const NON_NEGATIVE_INTEGER = /^(0|[1-9][0-9]*)$/;

class MealPlannerApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "MealPlannerApiError";
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
    throw new MealPlannerApiError(
      "MEALPLANNER_API_INVALID_RESPONSE",
      "Meal Planner returned an invalid response.",
      response.status,
    );
  }
}

function responseError(body: unknown, status: number): MealPlannerApiError {
  if (
    object(body) &&
    object(body.error) &&
    typeof body.error.code === "string" &&
    typeof body.error.message === "string"
  ) {
    return new MealPlannerApiError(body.error.code, body.error.message, status);
  }
  return new MealPlannerApiError("MEALPLANNER_API_FAILED", "The Meal Planner request failed.", status);
}

function parseMutationResult(
  body: unknown,
  clientMutationId: string,
): HomiModuleMutationSubmissionResult {
  if (!object(body) || !object(body.data)) {
    throw new MealPlannerApiError("MEALPLANNER_MUTATION_INVALID_RESPONSE", "The mutation response is invalid.");
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
    throw new MealPlannerApiError("MEALPLANNER_MUTATION_INVALID_RESPONSE", "The mutation response data is invalid.");
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
  meal: ["create", "update", "delete"],
  idea: ["create", "update", "delete"],
  settings: ["create", "update"],
};

async function submit(
  entityType: string,
  mutation: HomiModuleQueuedMutation,
  clientId: string,
  signal?: AbortSignal,
): Promise<HomiModuleMutationSubmissionResult> {
  if (
    mutation.moduleKey !== MEALPLANNER_MODULE_KEY ||
    mutation.entityType !== entityType ||
    !(ENTITY_OPERATIONS[entityType] ?? []).includes(mutation.operation) ||
    !UUID.test(mutation.householdId) ||
    !UUID.test(mutation.entityId) ||
    !UUID.test(mutation.clientMutationId) ||
    !UUID.test(clientId) ||
    !NON_NEGATIVE_INTEGER.test(mutation.baseRevision)
  ) {
    throw new MealPlannerApiError("MEALPLANNER_MUTATION_INVALID_INPUT", "The queued Meal Planner mutation is invalid.");
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
    moduleKey: MEALPLANNER_MODULE_KEY,
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
    const response = await fetch(`/api/v1/modules/mealplanner/${path}/${encodeURIComponent(change.entityId)}`, {
      credentials: "same-origin",
      headers: { "X-Homi-Household-ID": context.householdId, "X-Homi-Client-ID": context.clientId },
      ...(signal ? { signal } : {}),
    });
    const body = await json(response);
    if (!response.ok) throw responseError(body, response.status);
    if (!object(body) || !Object.hasOwn(body, "data")) {
      throw new MealPlannerApiError("MEALPLANNER_RESPONSE_INVALID", "The Meal Planner response shape is invalid.");
    }
    const value = parse(body.data);
    if (value.id !== change.entityId || BigInt(value.revision) < BigInt(change.revision)) {
      throw new MealPlannerApiError("MEALPLANNER_RESPONSE_STALE", "The Meal Planner response is stale.");
    }
    return value;
  }
  return Object.freeze({
    moduleKey: MEALPLANNER_MODULE_KEY,
    entityType,
    async materialize(change: HomiModuleSyncChange, context: HomiModuleSyncHandlerContext, signal?: AbortSignal) {
      if (
        change.moduleKey !== MEALPLANNER_MODULE_KEY ||
        change.entityType !== entityType ||
        change.householdId !== context.householdId
      ) {
        throw new MealPlannerApiError("MEALPLANNER_CHANGE_INVALID", "The Meal Planner sync change is invalid.");
      }
      const gone = () => Object.freeze({
        kind: "delete" as const, moduleKey: MEALPLANNER_MODULE_KEY, entityType,
        entityId: change.entityId, sequence: change.sequence,
      });
      if (change.operation === "delete") return gone();
      if (change.operation !== "create" && change.operation !== "update") {
        throw new MealPlannerApiError("MEALPLANNER_CHANGE_INVALID", "The Meal Planner sync operation is invalid.");
      }
      const value = await fetchOne(change, context, signal);
      if (value.deleted) return gone();
      return Object.freeze({
        kind: "put" as const, moduleKey: MEALPLANNER_MODULE_KEY, entityType,
        entityId: value.id, revision: value.revision, sequence: change.sequence, data: value,
      });
    },
  });
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLOT_VALUES = ["breakfast", "lunch", "dinner", "snack"];
const KIND_VALUES = ["meal", "eating-out", "leftovers", "takeout", "skip"];

function bad(what: string): never {
  throw new MealPlannerApiError("MEALPLANNER_RESPONSE_INVALID", `A Meal Planner ${what} response is invalid.`);
}

function parseRecipe(value: unknown): RecipeRef | null {
  if (value === null || value === undefined) return null;
  if (!object(value) || typeof value.id !== "string" || typeof value.title !== "string" ||
    !(value.servings === null || typeof value.servings === "number")) bad("recipe");
  return Object.freeze({ id: value.id, title: value.title, servings: value.servings as number | null });
}

function base(value: unknown, what: string, revisionPattern: RegExp): Record<string, unknown> & { id: string; revision: string; createdAt: string; updatedAt: string; deleted: boolean } {
  if (
    !object(value) || typeof value.id !== "string" || !UUID.test(value.id) ||
    typeof value.revision !== "string" || !revisionPattern.test(value.revision) ||
    typeof value.createdAt !== "string" || typeof value.updatedAt !== "string" || typeof value.deleted !== "boolean"
  ) bad(what);
  return value as never;
}

function parseMealValue(value: unknown, revisionPattern: RegExp): Meal {
  const v = base(value, "meal", revisionPattern);
  if (
    typeof v.date !== "string" || !DATE.test(v.date) || !SLOT_VALUES.includes(String(v.slot)) ||
    !KIND_VALUES.includes(String(v.kind)) || typeof v.title !== "string" || typeof v.notes !== "string" ||
    !(v.servings === null || typeof v.servings === "number") ||
    !(v.cookPersonId === null || (typeof v.cookPersonId === "string" && UUID.test(v.cookPersonId))) ||
    !(v.status === "planned" || v.status === "cooked") || typeof v.position !== "number" ||
    !(v.seriesId === null || (typeof v.seriesId === "string" && UUID.test(v.seriesId)))
  ) bad("meal");
  return Object.freeze({
    id: v.id, date: v.date as string, slot: v.slot as Slot, kind: v.kind as Kind, title: v.title as string, notes: v.notes as string,
    servings: v.servings as number | null, cookPersonId: v.cookPersonId as string | null, status: v.status as "planned" | "cooked",
    recipe: parseRecipe(v.recipe), position: v.position as number, seriesId: v.seriesId as string | null,
    revision: v.revision, createdAt: v.createdAt, updatedAt: v.updatedAt, deleted: v.deleted,
  });
}

export function parseMeal(value: unknown): Meal { return parseMealValue(value, POSITIVE_INTEGER); }
// A meal planned on this device has revision 0 and its payload merged in.
export function parseWorkingMeal(value: unknown): Meal {
  return parseMealValue(object(value) ? { deleted: false, recipe: null, seriesId: null, cookPersonId: null, servings: null, notes: "", status: "planned", position: 0, ...value } : value, NON_NEGATIVE_INTEGER);
}

function parseIdeaValue(value: unknown, revisionPattern: RegExp): Idea {
  const v = base(value, "idea", revisionPattern);
  if (typeof v.title !== "string" || typeof v.notes !== "string" || !Array.isArray(v.tags) || !v.tags.every((t) => typeof t === "string")) bad("idea");
  return Object.freeze({
    id: v.id, title: v.title as string, notes: v.notes as string, tags: Object.freeze([...(v.tags as string[])]),
    recipe: parseRecipe(v.recipe), revision: v.revision, createdAt: v.createdAt, updatedAt: v.updatedAt, deleted: v.deleted,
  });
}

export function parseIdea(value: unknown): Idea { return parseIdeaValue(value, POSITIVE_INTEGER); }
export function parseWorkingIdea(value: unknown): Idea {
  return parseIdeaValue(object(value) ? { deleted: false, recipe: null, notes: "", tags: [], ...value } : value, NON_NEGATIVE_INTEGER);
}

function parseSettingsValue(value: unknown, revisionPattern: RegExp): SettingsRecord {
  const v = base(value, "settings", revisionPattern);
  const ok =
    Array.isArray(v.slots) && v.slots.every((s) => SLOT_VALUES.includes(String(s))) &&
    typeof v.weekStart === "number" && (v.cardMode === "week" || v.cardMode === "upcoming") &&
    Array.isArray(v.cardDays) && v.cardDays.every((d) => typeof d === "number") &&
    typeof v.cardUpcoming === "number" && SLOT_VALUES.includes(String(v.cardSlot)) &&
    (v.cardLabel === "short" || v.cardLabel === "long") && object(v.dayColors);
  if (!ok) bad("settings");
  return Object.freeze({
    id: v.id, slots: [...(v.slots as Slot[])], weekStart: v.weekStart as number, cardMode: v.cardMode as "week" | "upcoming",
    cardDays: [...(v.cardDays as number[])], cardUpcoming: v.cardUpcoming as number, cardSlot: v.cardSlot as Slot,
    cardLabel: v.cardLabel as "short" | "long", dayColors: { ...(v.dayColors as Record<string, string>) },
    revision: v.revision, createdAt: v.createdAt, updatedAt: v.updatedAt,
  });
}

export function parseSettings(value: unknown): SettingsRecord {
  return parseSettingsValue(object(value) ? { deleted: false, ...value } : value, POSITIVE_INTEGER);
}
export function parseWorkingSettings(value: unknown): SettingsRecord {
  return parseSettingsValue(object(value) ? { deleted: false, ...value } : value, NON_NEGATIVE_INTEGER);
}

export const mealMutationAdapter = adapter("meal");
export const ideaMutationAdapter = adapter("idea");
export const settingsMutationAdapter = adapter("settings");
export const mealChangeHandler = changeHandler("meal", "meals", parseMeal);
export const ideaChangeHandler = changeHandler("idea", "ideas", parseIdea);
export const settingsChangeHandler = changeHandler("settings", "settings", (value) => {
  const record = parseSettings(value);
  return { ...record, deleted: false } as SettingsRecord & Parsed;
});
