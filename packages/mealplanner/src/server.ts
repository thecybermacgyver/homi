import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  HOMI_MODULE_API_VERSION,
  defineHomiServerModule,
  type HomiModuleDatabase,
  type HomiModuleServerMutationInput,
  type HomiModuleServerMutationResult,
  type HomiRequestContext,
  type HomiServerModuleHostContext,
} from "@homi/module-sdk";
import { KINDS, LIMITS, MEALPLANNER_MODULE_KEY, RECIPES_CAPABILITY, SETTINGS_ID, SLOTS } from "./constants.js";
import { addDays, isDate, today } from "./dates.js";
import type { Idea, IdeaFields, Meal, MealFields, PlanSettings, RecipeRef, SettingsRecord } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLOR = /^#[0-9a-f]{6}$/i;

function httpError(statusCode: number, code: string, message: string) {
  return Object.assign(new Error(message), { statusCode, code });
}
function invalid(message: string): never {
  throw httpError(400, "MEALPLANNER_INPUT_INVALID", message);
}
const iso = (value: string | Date): string => new Date(value).toISOString();

function headers(request: FastifyRequest) {
  return request.headers as Record<string, string | string[] | undefined>;
}
async function contextFor(host: HomiServerModuleHostContext, request: FastifyRequest): Promise<HomiRequestContext> {
  const context = await host.resolveContext({ id: request.id, headers: headers(request) });
  await host.requireEnabled(MEALPLANNER_MODULE_KEY, context);
  return context;
}

function hasExactly(payload: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const own = Object.keys(payload);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(payload, key));
}
function text(value: unknown, field: string, maximum: number, minimum = 0): string {
  if (typeof value !== "string") invalid(field + " must be text.");
  const result = (value as string).trim();
  if (result.length < minimum || result.length > maximum) invalid(field + " has an invalid length.");
  return result;
}
function uuidOrNull(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !UUID.test(value)) invalid(field + " must be an id.");
  return value as string;
}
function parseRecipe(value: unknown): RecipeRef | null {
  if (value === null) return null;
  const r = value as Record<string, unknown> | undefined;
  if (typeof r !== "object" || r === null || !hasExactly(r, ["id", "title", "servings"])) invalid("recipe is invalid.");
  const servings = r!.servings;
  if (!(servings === null || (Number.isInteger(servings) && (servings as number) >= 1 && (servings as number) <= 99))) invalid("recipe servings are invalid.");
  return { id: text(r!.id, "recipe id", 80, 1), title: text(r!.title, "recipe title", LIMITS.title, 1), servings: servings as number | null };
}

const MEAL_KEYS = ["date", "slot", "kind", "title", "notes", "servings", "cookPersonId", "status", "recipe", "position", "seriesId"];
function parseMeal(payload: Readonly<Record<string, unknown>>): MealFields {
  if (!hasExactly(payload, MEAL_KEYS)) invalid("The meal payload is invalid.");
  if (!isDate(payload.date)) invalid("date must be YYYY-MM-DD.");
  if (!(SLOTS as readonly unknown[]).includes(payload.slot)) invalid("slot is invalid.");
  if (!(KINDS as readonly unknown[]).includes(payload.kind)) invalid("kind is invalid.");
  if (payload.status !== "planned" && payload.status !== "cooked") invalid("status is invalid.");
  const kind = payload.kind as MealFields["kind"];
  const title = text(payload.title, "title", LIMITS.title, kind === "meal" ? 1 : 0);
  const servings = payload.servings;
  if (!(servings === null || (Number.isInteger(servings) && (servings as number) >= 1 && (servings as number) <= 99))) invalid("servings are invalid.");
  const position = payload.position;
  if (!Number.isInteger(position) || (position as number) < 0 || (position as number) > 1000) invalid("position is invalid.");
  return {
    date: payload.date as string, slot: payload.slot as MealFields["slot"], kind, title,
    notes: text(payload.notes, "notes", LIMITS.notes), servings: servings as number | null,
    cookPersonId: uuidOrNull(payload.cookPersonId, "cookPersonId"), status: payload.status as MealFields["status"],
    recipe: parseRecipe(payload.recipe), position: position as number, seriesId: uuidOrNull(payload.seriesId, "seriesId"),
  };
}

const IDEA_KEYS = ["title", "notes", "tags", "recipe"];
function parseIdea(payload: Readonly<Record<string, unknown>>): IdeaFields {
  if (!hasExactly(payload, IDEA_KEYS)) invalid("The idea payload is invalid.");
  const tags = payload.tags;
  if (!Array.isArray(tags) || tags.length > LIMITS.tags) invalid("tags are invalid.");
  return {
    title: text(payload.title, "title", LIMITS.title, 1), notes: text(payload.notes, "notes", LIMITS.notes),
    tags: [...new Set((tags as unknown[]).map((t) => text(t, "tag", LIMITS.tag, 1)))], recipe: parseRecipe(payload.recipe),
  };
}

const SETTINGS_KEYS = ["slots", "weekStart", "cardMode", "cardDays", "cardUpcoming", "cardSlot", "cardLabel", "dayColors"];
function parseSettings(payload: Readonly<Record<string, unknown>>): PlanSettings {
  if (!hasExactly(payload, SETTINGS_KEYS)) invalid("The settings payload is invalid.");
  const slots = payload.slots;
  if (!Array.isArray(slots) || slots.length < 1 || new Set(slots).size !== slots.length || !slots.every((s) => (SLOTS as readonly unknown[]).includes(s))) invalid("slots are invalid.");
  const days = payload.cardDays;
  if (!Array.isArray(days) || days.length < 1 || new Set(days).size !== days.length || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) invalid("cardDays are invalid.");
  if (!Number.isInteger(payload.weekStart) || (payload.weekStart as number) < 0 || (payload.weekStart as number) > 6) invalid("weekStart is invalid.");
  if (payload.cardMode !== "week" && payload.cardMode !== "upcoming") invalid("cardMode is invalid.");
  if (!Number.isInteger(payload.cardUpcoming) || (payload.cardUpcoming as number) < 1 || (payload.cardUpcoming as number) > 7) invalid("cardUpcoming is invalid.");
  if (!(slots as unknown[]).includes(payload.cardSlot)) invalid("cardSlot must be an enabled slot.");
  if (payload.cardLabel !== "short" && payload.cardLabel !== "long") invalid("cardLabel is invalid.");
  const colors = payload.dayColors as Record<string, unknown> | null;
  if (typeof colors !== "object" || colors === null || Object.keys(colors).length !== 7) invalid("dayColors are invalid.");
  const dayColors: Record<string, string> = {};
  for (let day = 0; day < 7; day++) {
    const color = colors![String(day)];
    if (typeof color !== "string" || !COLOR.test(color)) invalid("each day needs a #rrggbb colour.");
    dayColors[String(day)] = (color as string).toLowerCase();
  }
  return {
    slots: slots as PlanSettings["slots"], weekStart: payload.weekStart as number, cardMode: payload.cardMode as PlanSettings["cardMode"],
    cardDays: [...(days as number[])].sort((a, b) => a - b), cardUpcoming: payload.cardUpcoming as number,
    cardSlot: payload.cardSlot as PlanSettings["cardSlot"], cardLabel: payload.cardLabel as PlanSettings["cardLabel"], dayColors,
  };
}

interface MealRow extends Record<string, unknown> {
  id: string; date: string; slot: Meal["slot"]; kind: Meal["kind"]; title: string; notes: string; servings: number | null;
  cookPersonId: string | null; status: Meal["status"]; recipe: unknown; position: number; seriesId: string | null;
  revision: string; createdAt: string | Date; updatedAt: string | Date; deletedAt: string | Date | null;
}
interface IdeaRow extends Record<string, unknown> {
  id: string; title: string; notes: string; tags: unknown; recipe: unknown;
  revision: string; createdAt: string | Date; updatedAt: string | Date; deletedAt: string | Date | null;
}
interface SettingsRow extends Record<string, unknown> {
  id: string; config: unknown; revision: string; createdAt: string | Date; updatedAt: string | Date;
}
const json = <T>(value: unknown, fallback: T): T => (typeof value === "string" ? (JSON.parse(value) as T) : ((value as T) ?? fallback));

function mealState(row: MealRow, deleted = row.deletedAt !== null): Meal {
  return Object.freeze({
    id: row.id, date: row.date, slot: row.slot, kind: row.kind, title: row.title, notes: row.notes, servings: row.servings,
    cookPersonId: row.cookPersonId, status: row.status, recipe: json<RecipeRef | null>(row.recipe, null), position: row.position,
    seriesId: row.seriesId, revision: row.revision, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), deleted,
  });
}
function ideaState(row: IdeaRow, deleted = row.deletedAt !== null): Idea {
  return Object.freeze({
    id: row.id, title: row.title, notes: row.notes, tags: json<string[]>(row.tags, []), recipe: json<RecipeRef | null>(row.recipe, null),
    revision: row.revision, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), deleted,
  });
}
function settingsState(row: SettingsRow): SettingsRecord & { deleted: false } {
  return Object.freeze({
    ...json<PlanSettings>(row.config, {} as PlanSettings), id: row.id, revision: row.revision,
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), deleted: false as const,
  });
}

const mealSelection = `
  id::text AS id, to_char(meal_date, 'YYYY-MM-DD') AS date, slot, kind, title, notes, servings,
  cook_person_id::text AS "cookPersonId", status, recipe, position, series_id::text AS "seriesId",
  revision::text AS revision, created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"`;
const ideaSelection = `
  id::text AS id, title, notes, tags, recipe, revision::text AS revision,
  created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"`;
const settingsSelection = `
  id::text AS id, config, revision::text AS revision, created_at AS "createdAt", updated_at AS "updatedAt"`;

async function validateCook(host: HomiServerModuleHostContext, context: HomiRequestContext, cook: string | null): Promise<boolean> {
  if (cook === null) return true;
  if (!host.householdPeople) return false;
  return (await host.householdPeople.listActive(context)).some((person) => person.id === cook);
}

type Result = HomiModuleServerMutationResult;
const rejected = (code: string, revision: string | null = null, serverState: unknown = null): Result =>
  ({ status: "rejected", revision, errorCode: code, serverState } as Result);
const conflict = (revision: string, serverState: unknown): Result =>
  ({ status: "conflict", revision, errorCode: "REVISION_CONFLICT", serverState } as Result);

async function applyMeal(context: HomiRequestContext, database: HomiModuleDatabase, input: HomiModuleServerMutationInput, host: HomiServerModuleHostContext): Promise<Result> {
  if (!["create", "update", "delete"].includes(input.operation)) return rejected("MEALPLANNER_OPERATION_UNSUPPORTED");
  const found = await database.query<MealRow>(
    `SELECT ${mealSelection} FROM mod_mealplanner.meals WHERE household_id = $1::uuid AND id = $2::uuid FOR UPDATE`,
    [context.householdId, input.entityId]);
  const current = found.rows[0] ?? null;

  if (input.operation === "create") {
    let meal: MealFields;
    try { meal = parseMeal(input.payload); } catch { return rejected("MEALPLANNER_CREATE_INVALID"); }
    if (input.baseRevision !== "0" || current !== null) {
      return current ? conflict(current.revision, mealState(current)) : rejected("MEALPLANNER_CREATE_INVALID");
    }
    if (!(await validateCook(host, context, meal.cookPersonId))) return rejected("MEALPLANNER_COOK_INVALID");
    const inserted = await database.query<MealRow>(
      `INSERT INTO mod_mealplanner.meals (id, household_id, meal_date, slot, kind, title, notes, servings, cook_person_id, status, recipe, position, series_id, revision)
       VALUES ($1::uuid, $2::uuid, $3::date, $4, $5, $6, $7, $8, $9::uuid, $10, $11::jsonb, $12, $13::uuid, 1) RETURNING ${mealSelection}`,
      [input.entityId, context.householdId, meal.date, meal.slot, meal.kind, meal.title, meal.notes, meal.servings,
        meal.cookPersonId, meal.status, meal.recipe === null ? null : JSON.stringify(meal.recipe), meal.position, meal.seriesId]);
    const row = inserted.rows[0];
    if (!row) throw new Error("Meal insert returned no row.");
    return { status: "applied", revision: row.revision, serverState: mealState(row, false) };
  }
  if (!current || current.deletedAt !== null) return rejected("MEALPLANNER_MEAL_NOT_FOUND", current?.revision ?? null, current ? mealState(current) : null);
  if (current.revision !== input.baseRevision) return conflict(current.revision, mealState(current));

  if (input.operation === "update") {
    let meal: MealFields;
    try { meal = parseMeal(input.payload); } catch { return rejected("MEALPLANNER_UPDATE_INVALID", current.revision, mealState(current)); }
    if (!(await validateCook(host, context, meal.cookPersonId))) return rejected("MEALPLANNER_COOK_INVALID", current.revision, mealState(current));
    const updated = await database.query<MealRow>(
      `UPDATE mod_mealplanner.meals SET meal_date = $3::date, slot = $4, kind = $5, title = $6, notes = $7, servings = $8,
         cook_person_id = $9::uuid, status = $10, recipe = $11::jsonb, position = $12, series_id = $13::uuid,
         revision = revision + 1, updated_at = now()
       WHERE household_id = $1::uuid AND id = $2::uuid RETURNING ${mealSelection}`,
      [context.householdId, input.entityId, meal.date, meal.slot, meal.kind, meal.title, meal.notes, meal.servings,
        meal.cookPersonId, meal.status, meal.recipe === null ? null : JSON.stringify(meal.recipe), meal.position, meal.seriesId]);
    const row = updated.rows[0];
    if (!row) throw new Error("Meal update returned no row.");
    return { status: "applied", revision: row.revision, serverState: mealState(row, false) };
  }

  if (Object.keys(input.payload).length !== 0) return rejected("MEALPLANNER_DELETE_INVALID", current.revision, mealState(current));
  const deleted = await database.query<MealRow>(
    `UPDATE mod_mealplanner.meals SET revision = revision + 1, deleted_at = now(), updated_at = now()
     WHERE household_id = $1::uuid AND id = $2::uuid RETURNING ${mealSelection}`, [context.householdId, input.entityId]);
  const row = deleted.rows[0];
  if (!row) throw new Error("Meal delete returned no row.");
  return { status: "applied", revision: row.revision, serverState: mealState(row, true) };
}

async function applyIdea(context: HomiRequestContext, database: HomiModuleDatabase, input: HomiModuleServerMutationInput): Promise<Result> {
  if (!["create", "update", "delete"].includes(input.operation)) return rejected("MEALPLANNER_OPERATION_UNSUPPORTED");
  const found = await database.query<IdeaRow>(
    `SELECT ${ideaSelection} FROM mod_mealplanner.ideas WHERE household_id = $1::uuid AND id = $2::uuid FOR UPDATE`,
    [context.householdId, input.entityId]);
  const current = found.rows[0] ?? null;

  if (input.operation === "create") {
    let idea: IdeaFields;
    try { idea = parseIdea(input.payload); } catch { return rejected("MEALPLANNER_CREATE_INVALID"); }
    if (input.baseRevision !== "0" || current !== null) {
      return current ? conflict(current.revision, ideaState(current)) : rejected("MEALPLANNER_CREATE_INVALID");
    }
    const inserted = await database.query<IdeaRow>(
      `INSERT INTO mod_mealplanner.ideas (id, household_id, title, notes, tags, recipe, revision)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::jsonb, 1) RETURNING ${ideaSelection}`,
      [input.entityId, context.householdId, idea.title, idea.notes, JSON.stringify(idea.tags), idea.recipe === null ? null : JSON.stringify(idea.recipe)]);
    const row = inserted.rows[0];
    if (!row) throw new Error("Idea insert returned no row.");
    return { status: "applied", revision: row.revision, serverState: ideaState(row, false) };
  }
  if (!current || current.deletedAt !== null) return rejected("MEALPLANNER_IDEA_NOT_FOUND", current?.revision ?? null, current ? ideaState(current) : null);
  if (current.revision !== input.baseRevision) return conflict(current.revision, ideaState(current));

  if (input.operation === "update") {
    let idea: IdeaFields;
    try { idea = parseIdea(input.payload); } catch { return rejected("MEALPLANNER_UPDATE_INVALID", current.revision, ideaState(current)); }
    const updated = await database.query<IdeaRow>(
      `UPDATE mod_mealplanner.ideas SET title = $3, notes = $4, tags = $5::jsonb, recipe = $6::jsonb, revision = revision + 1, updated_at = now()
       WHERE household_id = $1::uuid AND id = $2::uuid RETURNING ${ideaSelection}`,
      [context.householdId, input.entityId, idea.title, idea.notes, JSON.stringify(idea.tags), idea.recipe === null ? null : JSON.stringify(idea.recipe)]);
    const row = updated.rows[0];
    if (!row) throw new Error("Idea update returned no row.");
    return { status: "applied", revision: row.revision, serverState: ideaState(row, false) };
  }

  if (Object.keys(input.payload).length !== 0) return rejected("MEALPLANNER_DELETE_INVALID", current.revision, ideaState(current));
  const deleted = await database.query<IdeaRow>(
    `UPDATE mod_mealplanner.ideas SET revision = revision + 1, deleted_at = now(), updated_at = now()
     WHERE household_id = $1::uuid AND id = $2::uuid RETURNING ${ideaSelection}`, [context.householdId, input.entityId]);
  const row = deleted.rows[0];
  if (!row) throw new Error("Idea delete returned no row.");
  return { status: "applied", revision: row.revision, serverState: ideaState(row, true) };
}

async function applySettings(context: HomiRequestContext, database: HomiModuleDatabase, input: HomiModuleServerMutationInput): Promise<Result> {
  if (input.operation !== "create" && input.operation !== "update") return rejected("MEALPLANNER_OPERATION_UNSUPPORTED");
  if (input.entityId !== SETTINGS_ID) return rejected("MEALPLANNER_SETTINGS_ID_INVALID");
  const found = await database.query<SettingsRow>(
    `SELECT ${settingsSelection} FROM mod_mealplanner.plan_settings WHERE household_id = $1::uuid AND id = $2::uuid FOR UPDATE`,
    [context.householdId, input.entityId]);
  const current = found.rows[0] ?? null;
  let config: PlanSettings;
  try { config = parseSettings(input.payload); } catch {
    return rejected(input.operation === "create" ? "MEALPLANNER_CREATE_INVALID" : "MEALPLANNER_UPDATE_INVALID", current?.revision ?? null, current ? settingsState(current) : null);
  }
  if (input.operation === "create") {
    if (input.baseRevision !== "0" || current !== null) {
      return current ? conflict(current.revision, settingsState(current)) : rejected("MEALPLANNER_CREATE_INVALID");
    }
    const inserted = await database.query<SettingsRow>(
      `INSERT INTO mod_mealplanner.plan_settings (household_id, id, config, revision) VALUES ($1::uuid, $2::uuid, $3::jsonb, 1) RETURNING ${settingsSelection}`,
      [context.householdId, input.entityId, JSON.stringify(config)]);
    const row = inserted.rows[0];
    if (!row) throw new Error("Settings insert returned no row.");
    return { status: "applied", revision: row.revision, serverState: settingsState(row) };
  }
  if (!current) return rejected("MEALPLANNER_SETTINGS_NOT_FOUND");
  if (current.revision !== input.baseRevision) return conflict(current.revision, settingsState(current));
  const updated = await database.query<SettingsRow>(
    `UPDATE mod_mealplanner.plan_settings SET config = $3::jsonb, revision = revision + 1, updated_at = now()
     WHERE household_id = $1::uuid AND id = $2::uuid RETURNING ${settingsSelection}`,
    [context.householdId, input.entityId, JSON.stringify(config)]);
  const row = updated.rows[0];
  if (!row) throw new Error("Settings update returned no row.");
  return { status: "applied", revision: row.revision, serverState: settingsState(row) };
}

function idParam(request: FastifyRequest, code: string): string {
  const id = (request.params as { id?: unknown }).id;
  if (typeof id !== "string" || !UUID.test(id)) throw httpError(400, code, "The id must be a UUID.");
  return id;
}

interface RecipeSummary { id: string; title: string; servings: number | null; minutes: number | null }
function recipeSummary(value: unknown): RecipeSummary | null {
  const r = value as Record<string, unknown> | null;
  if (typeof r !== "object" || r === null || typeof r.id !== "string" || typeof r.title !== "string") return null;
  const servings = Number.isInteger(r.servings) && (r.servings as number) >= 1 && (r.servings as number) <= 99 ? (r.servings as number) : null;
  const minutes = Number.isInteger(r.minutes) && (r.minutes as number) >= 0 ? (r.minutes as number) : null;
  return { id: r.id.slice(0, 80), title: r.title.slice(0, LIMITS.title), servings, minutes };
}

export function createHomiServerModule(host: HomiServerModuleHostContext) {
  const database = host.moduleDatabase;

  async function recipesState(context: HomiRequestContext) {
    if (!host.broker) return { state: "not-installed" as const, available: false };
    const status = await host.broker.status(context, RECIPES_CAPABILITY);
    return { state: status.state, available: status.available };
  }
  async function recipesCall(context: HomiRequestContext, action: string, payload: unknown): Promise<unknown> {
    const state = await recipesState(context);
    if (!state.available || !host.broker) {
      throw httpError(409, "MEALPLANNER_RECIPES_UNAVAILABLE",
        state.state === "not-installed" ? "Install Recipes from Modules to choose recipes." : "Enable Recipes for this household to choose recipes.");
    }
    return host.broker.invoke(context, RECIPES_CAPABILITY, { action, payload });
  }

  return defineHomiServerModule({
    moduleKey: MEALPLANNER_MODULE_KEY,
    moduleApiVersion: HOMI_MODULE_API_VERSION,

    register(app: FastifyInstance) {
      app.get("/api/v1/modules/mealplanner/health", async (request) => {
        await contextFor(host, request);
        return { data: { moduleKey: MEALPLANNER_MODULE_KEY, status: "ok" } };
      });

      app.get("/api/v1/modules/mealplanner/people", async (request) => {
        const context = await contextFor(host, request);
        if (!host.householdPeople) throw httpError(503, "MEALPLANNER_PEOPLE_UNAVAILABLE", "Household people are unavailable.");
        return { data: await host.householdPeople.listActive(context) };
      });

      // Recent and future meals; older history stays on the server.
      app.get("/api/v1/modules/mealplanner/meals", async (request) => {
        const context = await contextFor(host, request);
        const from = (request.query as { from?: unknown }).from;
        const start = isDate(from) ? from : addDays(today(context.timeZone), -90);
        const result = await database.query<MealRow>(
          `SELECT ${mealSelection} FROM mod_mealplanner.meals
           WHERE household_id = $1::uuid AND deleted_at IS NULL AND meal_date >= $2::date
           ORDER BY meal_date, slot, position, created_at`, [context.householdId, start]);
        return { data: result.rows.map((row) => mealState(row, false)) };
      });
      app.get("/api/v1/modules/mealplanner/meals/:id", async (request) => {
        const context = await contextFor(host, request);
        const result = await database.query<MealRow>(
          `SELECT ${mealSelection} FROM mod_mealplanner.meals WHERE household_id = $1::uuid AND id = $2::uuid LIMIT 1`,
          [context.householdId, idParam(request, "MEALPLANNER_MEAL_ID_INVALID")]);
        const row = result.rows[0];
        if (!row) throw httpError(404, "MEALPLANNER_MEAL_NOT_FOUND", "The meal was not found.");
        return { data: mealState(row) };
      });

      app.get("/api/v1/modules/mealplanner/ideas", async (request) => {
        const context = await contextFor(host, request);
        const result = await database.query<IdeaRow>(
          `SELECT ${ideaSelection} FROM mod_mealplanner.ideas WHERE household_id = $1::uuid AND deleted_at IS NULL ORDER BY lower(title)`,
          [context.householdId]);
        return { data: result.rows.map((row) => ideaState(row, false)) };
      });
      app.get("/api/v1/modules/mealplanner/ideas/:id", async (request) => {
        const context = await contextFor(host, request);
        const result = await database.query<IdeaRow>(
          `SELECT ${ideaSelection} FROM mod_mealplanner.ideas WHERE household_id = $1::uuid AND id = $2::uuid LIMIT 1`,
          [context.householdId, idParam(request, "MEALPLANNER_IDEA_ID_INVALID")]);
        const row = result.rows[0];
        if (!row) throw httpError(404, "MEALPLANNER_IDEA_NOT_FOUND", "The idea was not found.");
        return { data: ideaState(row) };
      });

      // The household's settings, or null when none have been saved yet.
      app.get("/api/v1/modules/mealplanner/settings", async (request) => {
        const context = await contextFor(host, request);
        const result = await database.query<SettingsRow>(
          `SELECT ${settingsSelection} FROM mod_mealplanner.plan_settings WHERE household_id = $1::uuid AND id = $2::uuid LIMIT 1`,
          [context.householdId, SETTINGS_ID]);
        const row = result.rows[0];
        return { data: row ? settingsState(row) : null };
      });
      app.get("/api/v1/modules/mealplanner/settings/:id", async (request) => {
        const context = await contextFor(host, request);
        const result = await database.query<SettingsRow>(
          `SELECT ${settingsSelection} FROM mod_mealplanner.plan_settings WHERE household_id = $1::uuid AND id = $2::uuid LIMIT 1`,
          [context.householdId, idParam(request, "MEALPLANNER_SETTINGS_ID_INVALID")]);
        const row = result.rows[0];
        if (!row) throw httpError(404, "MEALPLANNER_SETTINGS_NOT_FOUND", "The settings were not found.");
        return { data: settingsState(row) };
      });

      // Recipes come from a Recipes module through the public broker.
      app.get("/api/v1/modules/mealplanner/recipes/status", async (request) => {
        const context = await contextFor(host, request);
        return { data: await recipesState(context) };
      });
      app.get("/api/v1/modules/mealplanner/recipes/search", async (request) => {
        const context = await contextFor(host, request);
        const query = (request.query as { q?: unknown }).q;
        const result = await recipesCall(context, "search", { query: typeof query === "string" ? query.slice(0, 100) : "", limit: 20 });
        const list = Array.isArray(result) ? result : [];
        return { data: list.map(recipeSummary).filter((r): r is RecipeSummary => r !== null).slice(0, 20) };
      });
      app.get("/api/v1/modules/mealplanner/recipes/:id", async (request) => {
        const context = await contextFor(host, request);
        const id = (request.params as { id?: unknown }).id;
        if (typeof id !== "string" || id.length < 1 || id.length > 80) throw httpError(400, "MEALPLANNER_RECIPE_ID_INVALID", "The recipe id is invalid.");
        const recipe = recipeSummary(await recipesCall(context, "get", { id }));
        if (!recipe) throw httpError(404, "MEALPLANNER_RECIPE_NOT_FOUND", "The recipe was not found.");
        return { data: recipe };
      });
    },

    sync: {
      mutationHandlers: [
        { entityType: "meal", operations: ["create", "update", "delete"], apply: (context, database, input) => applyMeal(context, database, input, host) },
        { entityType: "idea", operations: ["create", "update", "delete"], apply: (context, database, input) => applyIdea(context, database, input) },
        { entityType: "settings", operations: ["create", "update"], apply: (context, database, input) => applySettings(context, database, input) },
      ],
    },
  });
}
