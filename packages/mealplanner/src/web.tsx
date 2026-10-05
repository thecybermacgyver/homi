import {
  useCallback, useEffect, useMemo, useRef, useState, type FormEvent,
} from "react";
import {
  defineHomiWebModule, HOMI_MODULE_API_VERSION,
  type HomiHouseholdPerson, type HomiWebModuleSearchProvider, type HomiWebModuleSurfaceProps,
  type HomiWebModuleMutationState, type HomiWebModuleMutationInput,
} from "@homi/module-sdk";
import { BottomSheet, Button, Checkbox, Dialog, FormField, Select, Tabs, TextArea, TextField } from "@homi/ui";
import {
  DAY_NAMES, DAY_SHORT, DEFAULT_SETTINGS, KINDS, KIND_LABELS, LIMITS, MEALPLANNER_MODULE_KEY, SETTINGS_ID, SLOTS, SLOT_LABELS,
} from "./constants.js";
import { addDays, formatDate, today as todayIn, weekDates } from "./dates.js";
import {
  cardRows, cardText, colorFor, inkFor, lastPlanned, mealLabel, mealsOn, nextPosition, searchText, sortMeals, suggestIdea, tint,
} from "./projection.js";
import {
  ideaChangeHandler, ideaMutationAdapter, mealChangeHandler, mealMutationAdapter, parseIdea, parseMeal,
  parseSettings, parseWorkingIdea, parseWorkingMeal, parseWorkingSettings, settingsChangeHandler, settingsMutationAdapter,
} from "./sync.js";
import type { Idea, IdeaFields, Meal, MealFields, PlanSettings, RecipeRef, SettingsRecord, Slot } from "./types.js";

const css = `
.mp {color:var(--homi-text);font-size:1rem}
.mp h1,.mp h2,.mp h3,.mp p {margin:0}
.mp-title {font-size:clamp(1.7rem,5vw,2.2rem);font-weight:600;margin:0 0 1rem}
.mp-status {font-size:.85rem;color:var(--homi-text-muted);margin:.6rem 0!important}
.mp-error {color:var(--homi-danger);margin:.6rem 0!important}
.mp-paper {background:var(--homi-surface);border:1px solid var(--homi-border);border-radius:var(--homi-radius-xl);padding:clamp(1rem,3vw,1.7rem);box-shadow:var(--homi-shadow-sm);max-width:60rem;margin:auto}
.mp-toolbar {display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin:.8rem 0}
.mp-toolbar .mp-range {flex:1;min-width:8rem;font-weight:700;text-align:center}
.mp-days {display:grid;gap:.7rem;grid-template-columns:1fr}
@media (min-width:760px) {.mp-days {grid-template-columns:1fr 1fr}}
.mp-day {border:1px solid var(--homi-border);border-radius:var(--homi-radius-md);overflow:hidden;background:var(--homi-surface-strong)}
.mp-day.is-today {box-shadow:0 0 0 3px var(--homi-primary-action)}
.mp-day-head {display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.5rem .8rem;font-weight:800}
.mp-day-body {padding:.4rem .8rem .7rem}
.mp-meal {display:flex;gap:.4rem;align-items:center;min-height:44px}
.mp-meal .homi-ui-check {flex:1;min-width:0;font-weight:600}
.mp-meal .homi-ui-check span {overflow-wrap:anywhere}
.mp-done .homi-ui-check span {text-decoration:line-through;color:var(--homi-text-muted)}
.mp-chip {font-size:.75rem;font-weight:700;border:1px solid var(--homi-border-strong);border-radius:999px;padding:.1rem .55rem;color:var(--homi-text-muted);white-space:nowrap}
.mp-link {border:0;background:transparent;color:var(--homi-primary-action);font-weight:700;padding:.5rem .3rem;min-height:44px;cursor:pointer;border-radius:var(--homi-radius-sm)}
.mp-link:hover,.mp-link:focus-visible {background:var(--homi-bg-soft)}
.mp-empty {color:var(--homi-text-muted);font-size:.9rem;margin:.3rem 0!important}
.mp-failure {border:1px solid var(--homi-danger);border-radius:var(--homi-radius-md);padding:.7rem .9rem;margin:0 0 .8rem;background:var(--homi-danger-soft)}
.mp-form {display:grid;gap:.85rem}
.mp-row2 {display:grid;gap:.7rem;grid-template-columns:1fr 1fr}
.mp-footer {display:flex;gap:.5rem;justify-content:space-between;flex-wrap:wrap;margin-top:.4rem}
.mp-recipe {border:1px solid var(--homi-border);border-radius:var(--homi-radius-md);padding:.6rem .8rem;display:grid;gap:.5rem}
.mp-results {list-style:none;margin:0;padding:0;display:grid;gap:.35rem;max-height:14rem;overflow:auto}
.mp-results button {width:100%;text-align:left;border:1px solid var(--homi-border);border-radius:var(--homi-radius-sm);background:var(--homi-surface-strong);color:inherit;padding:.5rem .7rem;min-height:44px;cursor:pointer}
.mp-ideas {list-style:none;margin:0;padding:0;display:grid;gap:.5rem}
.mp-idea {display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;border:1px solid var(--homi-border);border-radius:var(--homi-radius-md);padding:.5rem .8rem;background:var(--homi-surface-strong)}
.mp-idea-main {flex:1;min-width:10rem}
.mp-idea-main strong {overflow-wrap:anywhere}
.mp-colors {display:grid;gap:.5rem;grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))}
.mp-colorrow {display:flex;gap:.5rem;align-items:center}
.mp-color {width:46px;height:40px;padding:0;border:1px solid var(--homi-border-strong);border-radius:var(--homi-radius-sm);background:none;flex:none}
.mp-dayset {display:flex;gap:.4rem;flex-wrap:wrap}
.mp-dayset button {min-width:46px;min-height:44px;border-radius:var(--homi-radius-sm);border:1px solid var(--homi-border-strong);background:var(--homi-surface-strong);color:var(--homi-text);font-weight:700;cursor:pointer}
.mp-dayset button[aria-pressed="true"] {background:var(--homi-primary-action);border-color:var(--homi-primary-action);color:#fffdf9}
.mp-card {display:flex;flex-direction:column;gap:.45rem}
.homi-family-board__cell .mp.mp-card {flex:1 0 auto;min-height:150px}
.mp-row {display:flex;flex:1 1 0;min-height:2.3rem;width:100%;border:0;padding:0;border-radius:12px;overflow:hidden;cursor:pointer;text-align:left;font:inherit;color:inherit;touch-action:manipulation;box-shadow:0 1px 2px rgba(34,31,31,.16)}
.mp-row.is-today {outline:3px solid var(--homi-primary-action);outline-offset:1px}
.mp-row:focus-visible {outline:3px solid var(--homi-primary-action);outline-offset:2px}
.mp-row-day {flex:0 0 clamp(2.7rem,26%,4.8rem);display:grid;place-items:center;padding:0 .3rem;font-weight:700;font-size:clamp(.78rem,3.4cqw,1.1rem)}
.mp-row-meal {flex:1;min-width:0;display:flex;align-items:center;padding:.15rem .7rem;font-weight:800;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(.72rem,3.6cqw,1.1rem);line-height:1.15;overflow:hidden}
.mp-row-meal span {display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.mp-row-meal .mp-plan {font-weight:600;text-transform:none;font-style:italic}
.mp-card-footer {display:flex;justify-content:flex-end}
@container (max-height:230px) {.mp-card-footer {display:none}}
`;

async function getData(path: string, props: HomiWebModuleSurfaceProps, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch("/api/v1/modules/mealplanner/" + path, {
    credentials: "same-origin",
    headers: { "X-Homi-Household-ID": props.context.householdId, "X-Homi-Client-ID": props.context.clientId },
    ...(signal ? { signal } : {}),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? "The Meal Planner could not be loaded.");
  return body.data;
}

interface RecipeSummary { readonly id: string; readonly title: string; readonly servings: number | null; readonly minutes: number | null }
interface RecipesState { readonly state: "available" | "not-installed" | "not-enabled"; readonly available: boolean }

function useMealPlanner(props: HomiWebModuleSurfaceProps) {
  const latest = useRef(props); latest.current = props;
  const [meals, setMeals] = useState<Meal[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [stored, setStored] = useState<SettingsRecord | null>(null);
  const [mutations, setMutations] = useState<readonly HomiWebModuleMutationState[]>([]);
  const [people, setPeople] = useState<readonly HomiHouseholdPerson[]>([]);
  const [recipes, setRecipes] = useState<RecipesState>({ state: "not-installed", available: false });
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const active = useRef(true);
  const generation = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(id); }, []);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    const actions = latest.current.actions;
    const [m, i, s, pending] = await Promise.all([
      actions.listWorkingEntities("meal"), actions.listWorkingEntities("idea"),
      actions.listWorkingEntities("settings"), actions.listMutations(),
    ]);
    if (!active.current || mine !== generation.current) return;
    setMeals(m.map((row) => parseWorkingMeal(row.data)).filter((x) => !x.deleted));
    setIdeas(i.map((row) => parseWorkingIdea(row.data)).filter((x) => !x.deleted)
      .sort((a, b) => a.title.localeCompare(b.title, latest.current.context.locale)));
    const settings = s.map((row) => parseWorkingSettings(row.data)).find((x) => x.id === SETTINGS_ID) ?? null;
    setStored(settings);
    setMutations(pending);
    setLoaded(true);
  }, []);

  useEffect(() => { active.current = true; return () => { active.current = false; generation.current++; }; }, []);
  // The host supplies new actions when Core's sync state changes.
  useEffect(() => { void refresh().catch((e) => setError(String(e.message ?? e))); }, [props.actions, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    const initial = async () => {
      const p = latest.current;
      const [cachedPeople, cachedRecipes] = await Promise.all([p.actions.listCachedEntities("people"), p.actions.listCachedEntities("recipes")]);
      if (!controller.signal.aborted && cachedPeople[0]) setPeople(cachedPeople[0].data as HomiHouseholdPerson[]);
      if (!controller.signal.aborted && cachedRecipes[0]) setRecipes(cachedRecipes[0].data as RecipesState);
      if (!p.context.online) return;
      const [mealRows, ideaRows, settingsRow, persons, status] = await Promise.all([
        getData("meals", p, controller.signal), getData("ideas", p, controller.signal), getData("settings", p, controller.signal),
        getData("people", p, controller.signal), getData("recipes/status", p, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      if (!Array.isArray(mealRows) || !Array.isArray(ideaRows) || !Array.isArray(persons)) throw new Error("Invalid Meal Planner response.");
      const parsedMeals = mealRows.map(parseMeal);
      const parsedIdeas = ideaRows.map(parseIdea);
      await p.actions.replaceCachedEntities("meal", parsedMeals.map((x) => ({ entityId: x.id, revision: x.revision, data: x })));
      await p.actions.replaceCachedEntities("idea", parsedIdeas.map((x) => ({ entityId: x.id, revision: x.revision, data: x })));
      const parsedSettings = settingsRow === null ? null : parseSettings(settingsRow);
      await p.actions.replaceCachedEntities("settings", parsedSettings ? [{ entityId: parsedSettings.id, revision: parsedSettings.revision, data: parsedSettings }] : []);
      await p.actions.replaceCachedEntities("people", [{ entityId: "active", revision: "0", data: persons }]);
      await p.actions.replaceCachedEntities("recipes", [{ entityId: "status", revision: "0", data: status }]);
      if (controller.signal.aborted) return;
      setPeople(persons as HomiHouseholdPerson[]); setRecipes(status as RecipesState);
      await refresh();
    };
    void initial().catch((e) => { if (!controller.signal.aborted) setError(String(e.message ?? e)); });
    return () => controller.abort();
  }, [props.context.authSubject, props.context.householdId, props.context.online, refresh]);

  // Changes are queued one after another so quick taps are never dropped.
  const mutate = useCallback((input: HomiWebModuleMutationInput): Promise<boolean> => {
    const run = chain.current.then(async () => {
      setBusy(true); setError("");
      try { await latest.current.actions.enqueueMutation(input); await refresh(); return true; }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
      finally { setBusy(false); }
    });
    chain.current = run;
    return run;
  }, [refresh]);

  const settings: PlanSettings = stored ?? DEFAULT_SETTINGS;
  const todayDate = todayIn(props.context.timeZone, now);

  const mealPayload = (fields: MealFields): Record<string, unknown> => ({ ...fields });
  const createMeal = (fields: MealFields) => mutate({ entityType: "meal", entityId: crypto.randomUUID(), operation: "create", baseRevision: "0", payload: mealPayload(fields) });
  const updateMeal = (meal: Meal, fields: MealFields) => mutate({ entityType: "meal", entityId: meal.id, operation: "update", baseRevision: meal.revision, payload: mealPayload(fields) });
  const fieldsOf = (meal: Meal): MealFields => ({
    date: meal.date, slot: meal.slot, kind: meal.kind, title: meal.title, notes: meal.notes, servings: meal.servings,
    cookPersonId: meal.cookPersonId, status: meal.status, recipe: meal.recipe, position: meal.position, seriesId: meal.seriesId,
  });
  async function saveMeal(meal: Meal | null, fields: MealFields, repeatWeeks: number): Promise<boolean> {
    if (meal) {
      const moved = meal.date !== fields.date || meal.slot !== fields.slot;
      return updateMeal(meal, { ...fields, position: moved ? nextPosition(meals, fields.date, fields.slot) : meal.position });
    }
    const seriesId = repeatWeeks > 1 ? crypto.randomUUID() : null;
    let ok = true;
    for (let i = 0; i < Math.max(1, repeatWeeks); i++) {
      const date = addDays(fields.date, i * 7);
      ok = (await createMeal({ ...fields, date, seriesId, position: nextPosition(meals, date, fields.slot) })) && ok;
    }
    return ok;
  }
  const toggleCooked = (meal: Meal) => updateMeal(meal, { ...fieldsOf(meal), status: meal.status === "cooked" ? "planned" : "cooked" });
  const removeMeal = (meal: Meal) => mutate({ entityType: "meal", entityId: meal.id, operation: "delete", baseRevision: meal.revision, payload: {} });
  async function removeRepeats(meal: Meal): Promise<boolean> {
    let ok = true;
    for (const m of meals.filter((x) => meal.seriesId !== null && x.seriesId === meal.seriesId && x.date >= meal.date)) ok = (await removeMeal(m)) && ok;
    return ok;
  }
  const copyMeal = (meal: Meal, date: string) => createMeal({ ...fieldsOf(meal), date, status: "planned", seriesId: null, position: nextPosition(meals, date, meal.slot) });
  async function copyWeek(weekDate: string): Promise<number> {
    const here = weekDates(weekDate, settings.weekStart);
    let copied = 0;
    for (const date of here) {
      const from = addDays(date, -7);
      for (const meal of mealsOn(meals, from)) {
        if (!settings.slots.includes(meal.slot) || mealsOn(meals, date, meal.slot).length > 0) continue;
        if (await createMeal({ ...fieldsOf(meal), date, status: "planned", seriesId: null, position: 0 })) copied++;
      }
    }
    return copied;
  }
  const saveIdea = (idea: Idea | null, fields: IdeaFields) => mutate({
    entityType: "idea", entityId: idea?.id ?? crypto.randomUUID(), operation: idea ? "update" : "create",
    baseRevision: idea?.revision ?? "0", payload: { ...fields },
  });
  const removeIdea = (idea: Idea) => mutate({ entityType: "idea", entityId: idea.id, operation: "delete", baseRevision: idea.revision, payload: {} });
  // Only the settings fields are sent, never the stored record's id and revision.
  const saveSettings = (config: PlanSettings) => mutate({
    entityType: "settings", entityId: SETTINGS_ID, operation: stored ? "update" : "create", baseRevision: stored?.revision ?? "0",
    payload: {
      slots: config.slots, weekStart: config.weekStart, cardMode: config.cardMode, cardDays: config.cardDays, cardUpcoming: config.cardUpcoming,
      cardSlot: config.cardSlot, cardLabel: config.cardLabel, dayColors: config.dayColors,
    },
  });
  const dismiss = async (id: string) => {
    try { await latest.current.actions.dismissMutation(id); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return {
    meals, ideas, settings, people, recipes, error, loaded, busy, todayDate, dismiss,
    saveMeal, toggleCooked, removeMeal, removeRepeats, copyMeal, copyWeek, saveIdea, removeIdea, saveSettings, fieldsOf,
    pending: mutations.filter((m) => m.status === "queued" || m.status === "sending").length,
    failures: mutations.filter((m) => m.status === "conflict" || m.status === "rejected"),
  };
}
type Data = ReturnType<typeof useMealPlanner>;

interface MealEditor { readonly meal: Meal | null; readonly fields: MealFields; readonly resolutionId?: string; readonly back: string | null }

function blankFields(data: Data, date: string, slot?: Slot): MealFields {
  return {
    date, slot: slot ?? (data.settings.slots.includes(data.settings.cardSlot) ? data.settings.cardSlot : data.settings.slots[0] ?? "dinner"),
    kind: "meal", title: "", notes: "", servings: null, cookPersonId: null, status: "planned", recipe: null, position: 0, seriesId: null,
  };
}

function RecipeSection({ props, data, fields, setFields }: {
  props: HomiWebModuleSurfaceProps; data: Data; fields: MealFields; setFields: (fields: MealFields) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly RecipeSummary[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!open || !props.context.online) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      getData("recipes/search?q=" + encodeURIComponent(query), props, controller.signal)
        .then((rows) => { setResults(Array.isArray(rows) ? (rows as RecipeSummary[]) : []); setMessage(""); })
        .catch((e) => { if (!controller.signal.aborted) setMessage(String(e.message ?? e)); });
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, query, props.context.online, props.context.householdId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data.recipes.available && fields.recipe === null) return null;
  return (
    <div className="mp-recipe" role="group" aria-label="Recipe">
      <strong>Recipe</strong>
      {fields.recipe && <p>{fields.recipe.title}{fields.recipe.servings ? ` · serves ${fields.recipe.servings}` : ""}</p>}
      <div className="mp-footer">
        {data.recipes.available && <Button variant="secondary" onClick={() => setOpen(!open)}>{fields.recipe ? "Change recipe" : "Choose a recipe"}</Button>}
        {fields.recipe && <Button variant="quiet" onClick={() => setFields({ ...fields, recipe: null })}>Remove recipe</Button>}
      </div>
      {open && (props.context.online
        ? <>
          <TextField aria-label="Search recipes" placeholder="Search recipes…" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
          {message && <p className="mp-error" role="alert">{message}</p>}
          <ul className="mp-results" aria-label="Recipes">
            {results.map((r) => <li key={r.id}>
              <button type="button" onClick={() => {
                setFields({ ...fields, recipe: { id: r.id, title: r.title, servings: r.servings }, title: fields.title.trim() ? fields.title : r.title, servings: fields.servings ?? r.servings });
                setOpen(false);
              }}>{r.title}{r.minutes ? ` · ${r.minutes} min` : ""}</button>
            </li>)}
            {results.length === 0 && !message && <li className="mp-empty">No recipes found.</li>}
          </ul>
        </>
        : <p className="mp-status">Choosing a recipe needs a connection.</p>)}
    </div>
  );
}

function MealSheet({ props, data, editor, onClose, onSaved }: {
  props: HomiWebModuleSurfaceProps; data: Data; editor: MealEditor | null; onClose: () => void; onSaved: () => void;
}) {
  return (
    <BottomSheet portal open={editor !== null} title={editor?.meal ? "Edit meal" : "Add a meal"} onDismiss={onClose}>
      {editor && <MealForm key={editor.meal?.id ?? "new"} props={props} data={data} editor={editor} onClose={onClose} onSaved={onSaved} />}
    </BottomSheet>
  );
}

function MealForm({ props, data, editor, onClose, onSaved }: {
  props: HomiWebModuleSurfaceProps; data: Data; editor: MealEditor; onClose: () => void; onSaved: () => void;
}) {
  const [fields, setFields] = useState(editor.fields);
  const [repeat, setRepeat] = useState(0);
  const [copyTo, setCopyTo] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const meal = editor.meal;
  const needsTitle = fields.kind === "meal";
  async function submit(event: FormEvent) {
    event.preventDefault();
    const clean = { ...fields, title: fields.title.trim(), notes: fields.notes.trim() };
    const ok = await data.saveMeal(meal, clean, repeat);
    if (ok && editor.resolutionId) await data.dismiss(editor.resolutionId);
    if (ok) onSaved();
  }
  const ideasForPick = data.ideas;
  return (
    <form className="mp mp-form" onSubmit={(e) => void submit(e)}>
      {editor.resolutionId && <p role="status">Review your change below. Saving submits it against the shared version.</p>}
      <div className="mp-row2">
        <FormField label="Date" htmlFor="mp-date"><TextField id="mp-date" type="date" required value={fields.date} onChange={(e) => e.currentTarget.value && setFields({ ...fields, date: e.currentTarget.value })} /></FormField>
        <FormField label="Meal" htmlFor="mp-slot"><Select id="mp-slot" value={fields.slot} onChange={(e) => setFields({ ...fields, slot: e.currentTarget.value as Slot })}>
          {SLOTS.filter((s) => data.settings.slots.includes(s) || s === fields.slot).map((s) => <option key={s} value={s}>{SLOT_LABELS[s]}</option>)}
        </Select></FormField>
      </div>
      <FormField label="Type" htmlFor="mp-kind"><Select id="mp-kind" value={fields.kind} onChange={(e) => setFields({ ...fields, kind: e.currentTarget.value as MealFields["kind"] })}>
        {KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
      </Select></FormField>
      {!meal && ideasForPick.length > 0 && <FormField label="Use a saved idea" htmlFor="mp-idea"><Select id="mp-idea" value="" onChange={(e) => {
        const idea = ideasForPick.find((i) => i.id === e.currentTarget.value);
        if (idea) setFields({ ...fields, title: idea.title, notes: fields.notes || idea.notes, recipe: idea.recipe ?? fields.recipe });
      }}>
        <option value="">Choose…</option>{ideasForPick.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
      </Select></FormField>}
      <FormField label={needsTitle ? "What's for the meal?" : "Details (optional)"} htmlFor="mp-title">
        <TextField id="mp-title" autoFocus required={needsTitle} maxLength={LIMITS.title} value={fields.title} onChange={(e) => setFields({ ...fields, title: e.currentTarget.value })} />
      </FormField>
      <RecipeSection props={props} data={data} fields={fields} setFields={setFields} />
      <div className="mp-row2">
        <FormField label="Servings" htmlFor="mp-servings"><TextField id="mp-servings" type="number" min={1} max={99} value={fields.servings ?? ""}
          onChange={(e) => setFields({ ...fields, servings: e.currentTarget.value === "" ? null : Math.min(99, Math.max(1, Math.round(Number(e.currentTarget.value)))) })} /></FormField>
        <FormField label="Who's cooking?" htmlFor="mp-cook"><Select id="mp-cook" value={fields.cookPersonId ?? ""} onChange={(e) => setFields({ ...fields, cookPersonId: e.currentTarget.value || null })}>
          <option value="">Anyone</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
        </Select></FormField>
      </div>
      <FormField label="Notes" htmlFor="mp-notes"><TextArea id="mp-notes" rows={3} maxLength={LIMITS.notes} value={fields.notes} onChange={(e) => setFields({ ...fields, notes: e.currentTarget.value })} /></FormField>
      {meal && <Checkbox label="Cooked" checked={fields.status === "cooked"} onChange={(e) => setFields({ ...fields, status: e.currentTarget.checked ? "cooked" : "planned" })} />}
      {!meal && <FormField label="Repeat" htmlFor="mp-repeat"><Select id="mp-repeat" value={String(repeat)} onChange={(e) => setRepeat(Number(e.currentTarget.value))}>
        <option value="0">Does not repeat</option>
        {[4, 8, 12, LIMITS.repeatWeeks].map((n) => <option key={n} value={n}>Every week for {n} weeks</option>)}
      </Select></FormField>}
      <div className="mp-footer">
        <Button type="submit" disabled={data.busy || (needsTitle && !fields.title.trim())}>Save meal</Button>
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
      </div>
      {meal && <div role="group" aria-label="More actions" className="mp-recipe">
        <div className="mp-row2">
          <FormField label="Copy to another day" htmlFor="mp-copy"><TextField id="mp-copy" type="date" value={copyTo} onChange={(e) => setCopyTo(e.currentTarget.value)} /></FormField>
          <div style={{ alignSelf: "end" }}><Button variant="secondary" disabled={data.busy || !copyTo} onClick={() => void data.copyMeal(meal, copyTo).then((ok) => { if (ok) { setCopyTo(""); onSaved(); } })}>Copy meal</Button></div>
        </div>
        {confirmDelete
          ? <div className="mp-footer">
            <Button variant="danger" disabled={data.busy} onClick={() => void data.removeMeal(meal).then((ok) => { if (ok) onSaved(); })}>Delete this meal</Button>
            {meal.seriesId && <Button variant="danger" disabled={data.busy} onClick={() => void data.removeRepeats(meal).then((ok) => { if (ok) onSaved(); })}>Delete this and later repeats</Button>}
            <Button variant="quiet" onClick={() => setConfirmDelete(false)}>Keep</Button>
          </div>
          : <Button variant="quiet" onClick={() => setConfirmDelete(true)}>Delete…</Button>}
      </div>}
    </form>
  );
}

function IdeaSheet({ data, idea, open, onClose, onPlan }: {
  data: Data; idea: Idea | null; open: boolean; onClose: () => void; onPlan: (fields: Pick<MealFields, "title" | "notes" | "recipe">) => void;
}) {
  return (
    <BottomSheet portal open={open} title={idea ? "Edit idea" : "Add a meal idea"} onDismiss={onClose}>
      {open && <IdeaForm key={idea?.id ?? "new"} data={data} idea={idea} onClose={onClose} onPlan={onPlan} />}
    </BottomSheet>
  );
}

function IdeaForm({ data, idea, onClose, onPlan }: { data: Data; idea: Idea | null; onClose: () => void; onPlan: (fields: Pick<MealFields, "title" | "notes" | "recipe">) => void }) {
  const [title, setTitle] = useState(idea?.title ?? "");
  const [notes, setNotes] = useState(idea?.notes ?? "");
  const [tags, setTags] = useState((idea?.tags ?? []).join(", "));
  const [confirm, setConfirm] = useState(false);
  const parsedTags = () => [...new Set(tags.split(",").map((t) => t.trim()).filter(Boolean))].slice(0, LIMITS.tags);
  return (
    <form className="mp mp-form" onSubmit={(e) => { e.preventDefault(); void data.saveIdea(idea, { title: title.trim(), notes: notes.trim(), tags: parsedTags(), recipe: idea?.recipe ?? null }).then((ok) => { if (ok) onClose(); }); }}>
      <FormField label="Meal" htmlFor="mp-idea-title"><TextField id="mp-idea-title" autoFocus required maxLength={LIMITS.title} value={title} onChange={(e) => setTitle(e.currentTarget.value)} /></FormField>
      <FormField label="Tags" htmlFor="mp-idea-tags" hint="Separate with commas, for example: quick, vegetarian."><TextField id="mp-idea-tags" maxLength={200} value={tags} onChange={(e) => setTags(e.currentTarget.value)} /></FormField>
      <FormField label="Notes" htmlFor="mp-idea-notes"><TextArea id="mp-idea-notes" rows={3} maxLength={LIMITS.notes} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} /></FormField>
      <div className="mp-footer">
        <Button type="submit" disabled={data.busy || !title.trim()}>Save idea</Button>
        {idea && <Button variant="secondary" onClick={() => onPlan({ title: idea.title, notes: idea.notes, recipe: idea.recipe })}>Plan it</Button>}
        {idea && (confirm
          ? <Button variant="danger" disabled={data.busy} onClick={() => void data.removeIdea(idea).then((ok) => { if (ok) onClose(); })}>Delete idea</Button>
          : <Button variant="quiet" onClick={() => setConfirm(true)}>Delete…</Button>)}
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

function SettingsSheet({ data, open, onClose }: { data: Data; open: boolean; onClose: () => void }) {
  return (
    <BottomSheet portal open={open} title="Meal Planner settings" onDismiss={onClose}>
      {open && <SettingsForm data={data} onClose={onClose} />}
    </BottomSheet>
  );
}

function SettingsForm({ data, onClose }: { data: Data; onClose: () => void }) {
  const [cfg, setCfg] = useState<PlanSettings>(data.settings);
  const toggle = <T,>(list: readonly T[], value: T): T[] => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  const slots = cfg.slots;
  const valid = slots.length > 0 && cfg.cardDays.length > 0 && slots.includes(cfg.cardSlot);
  const order = Array.from({ length: 7 }, (_, i) => (cfg.weekStart + i) % 7);
  return (
    <form className="mp mp-form" onSubmit={(e) => { e.preventDefault(); void data.saveSettings({ ...cfg, cardDays: [...cfg.cardDays].sort((a, b) => a - b) }).then((ok) => { if (ok) onClose(); }); }}>
      <p>These settings are shared by the whole household.</p>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend><strong>Meals to plan</strong></legend>
        {SLOTS.map((s) => <Checkbox key={s} label={SLOT_LABELS[s]} checked={slots.includes(s)} disabled={slots.length === 1 && slots.includes(s)}
          onChange={() => { const next = toggle(slots, s).sort((a, b) => SLOTS.indexOf(a) - SLOTS.indexOf(b)); setCfg({ ...cfg, slots: next, cardSlot: next.includes(cfg.cardSlot) ? cfg.cardSlot : next[0] ?? "dinner" }); }} />)}
      </fieldset>
      <FormField label="Week starts on" htmlFor="mp-weekstart"><Select id="mp-weekstart" value={String(cfg.weekStart)} onChange={(e) => setCfg({ ...cfg, weekStart: Number(e.currentTarget.value) })}>
        {DAY_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
      </Select></FormField>
      <h3>Dashboard card</h3>
      <div role="group" aria-label="Days shown on the card">
        <p><strong>Days to show</strong></p>
        <div className="mp-dayset">{order.map((d) => <button key={d} type="button" aria-pressed={cfg.cardDays.includes(d)} aria-label={DAY_NAMES[d]}
          onClick={() => setCfg({ ...cfg, cardDays: toggle(cfg.cardDays, d) })}>{DAY_SHORT[d]}</button>)}</div>
      </div>
      <FormField label="Which days" htmlFor="mp-mode"><Select id="mp-mode" value={cfg.cardMode} onChange={(e) => setCfg({ ...cfg, cardMode: e.currentTarget.value as PlanSettings["cardMode"] })}>
        <option value="week">This week's chosen days</option><option value="upcoming">The next days from today</option>
      </Select></FormField>
      {cfg.cardMode === "upcoming" && <FormField label="How many days" htmlFor="mp-upcoming"><Select id="mp-upcoming" value={String(cfg.cardUpcoming)} onChange={(e) => setCfg({ ...cfg, cardUpcoming: Number(e.currentTarget.value) })}>
        {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
      </Select></FormField>}
      <div className="mp-row2">
        <FormField label="Meal shown" htmlFor="mp-cardslot"><Select id="mp-cardslot" value={cfg.cardSlot} onChange={(e) => setCfg({ ...cfg, cardSlot: e.currentTarget.value as Slot })}>
          {slots.map((s) => <option key={s} value={s}>{SLOT_LABELS[s]}</option>)}
        </Select></FormField>
        <FormField label="Day names" htmlFor="mp-label"><Select id="mp-label" value={cfg.cardLabel} onChange={(e) => setCfg({ ...cfg, cardLabel: e.currentTarget.value as PlanSettings["cardLabel"] })}>
          <option value="short">Mon</option><option value="long">Monday</option>
        </Select></FormField>
      </div>
      <div role="group" aria-label="Day colours">
        <p><strong>Day colours</strong></p>
        <div className="mp-colors">{order.map((d) => <label key={d} className="mp-colorrow">
          <input type="color" className="mp-color" aria-label={`${DAY_NAMES[d]} colour`} value={colorFor(cfg, d)} onChange={(e) => setCfg({ ...cfg, dayColors: { ...cfg.dayColors, [String(d)]: e.currentTarget.value.toLowerCase() } })} />
          <span>{DAY_NAMES[d]}</span>
        </label>)}</div>
        <Button variant="quiet" onClick={() => setCfg({ ...cfg, dayColors: { ...DEFAULT_SETTINGS.dayColors } })}>Reset colours</Button>
      </div>
      <div className="mp-footer">
        <Button type="submit" disabled={data.busy || !valid}>Save settings</Button>
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

function Failures({ data, onReview }: { data: Data; onReview: (editor: MealEditor) => void }) {
  return <>{data.failures.map((failure) => (
    <div role="alert" key={failure.clientMutationId} className="mp-failure">
      <p>{failure.status === "conflict" ? "Someone changed this before your change arrived." : "A change could not be saved."} {String(failure.payload.title ?? "")}</p>
      <Button variant="quiet" onClick={() => void data.dismiss(failure.clientMutationId)}>Keep shared version</Button>
      {failure.entityType === "meal" && failure.operation === "update" && "slot" in failure.payload && (
        <Button variant="quiet" onClick={() => {
          const shared = failure.serverState ? parseMeal(failure.serverState) : null;
          onReview({ meal: shared && !shared.deleted ? shared : null, resolutionId: failure.clientMutationId, back: null, fields: failure.payload as unknown as MealFields });
        }}>Review meal</Button>
      )}
    </div>
  ))}</>;
}

interface Sheets {
  editor: MealEditor | null; day: string | null;
  idea: { idea: Idea | null } | null; settings: boolean;
}

function useSheets() {
  const [state, setState] = useState<Sheets>({ editor: null, day: null, idea: null, settings: false });
  return {
    state,
    openDay: (day: string | null) => setState((s) => ({ ...s, day, editor: null })),
    openEditor: (editor: MealEditor | null) => setState((s) => ({ ...s, editor, day: editor ? null : s.day })),
    closeEditor: () => setState((s) => ({ ...s, editor: null, day: s.editor?.back ?? null })),
    openIdea: (idea: { idea: Idea | null } | null) => setState((s) => ({ ...s, idea })),
    openSettings: (open: boolean) => setState((s) => ({ ...s, settings: open })),
  };
}

function DaySheet({ props, data, date, onAdd, onEdit, onClose, onOpenPlanner }: {
  props: HomiWebModuleSurfaceProps; data: Data; date: string | null; onAdd: (date: string) => void;
  onEdit: (meal: Meal) => void; onClose: () => void; onOpenPlanner?: () => void;
}) {
  const list = date ? mealsOn(data.meals, date) : [];
  return (
    <BottomSheet portal open={date !== null} title={date ? formatDate(date, props.context.locale, { weekday: "long", month: "long", day: "numeric" }) : ""} onDismiss={onClose}>
      {date && <div className="mp">
        {list.length === 0 ? <p className="mp-empty">Nothing planned for this day.</p> : <ul className="mp-ideas">{list.map((meal) => (
          <li key={meal.id} className={"mp-idea" + (meal.status === "cooked" ? " mp-done" : "")}>
            <div className="mp-idea-main"><strong>{mealLabel(meal)}</strong>{data.settings.slots.length > 1 || meal.slot !== "dinner" ? <span className="mp-chip" style={{ marginLeft: ".5rem" }}>{SLOT_LABELS[meal.slot]}</span> : null}</div>
            <Button variant="secondary" onClick={() => onEdit(meal)} aria-label={"Edit " + mealLabel(meal)}>Edit</Button>
          </li>
        ))}</ul>}
        <div className="mp-footer" style={{ marginTop: ".8rem" }}>
          <Button onClick={() => onAdd(date)}>Add a meal</Button>
          {onOpenPlanner && <Button variant="secondary" onClick={onOpenPlanner}>Open the planner</Button>}
          <Button variant="quiet" onClick={onClose}>Done</Button>
        </div>
      </div>}
    </BottomSheet>
  );
}

function WeeklyPlanCard(props: HomiWebModuleSurfaceProps) {
  const data = useMealPlanner(props);
  const sheets = useSheets();
  const rows = useMemo(() => cardRows(data.settings, data.meals, data.todayDate), [data.settings, data.meals, data.todayDate]);
  const slotLabel = SLOT_LABELS[data.settings.cardSlot];
  return (
    <div className="mp mp-card" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <style>{css}</style>
      {rows.map((row) => {
        const body = cardText(row);
        const light = tint(row.color, 0.5);
        const lightInk = inkFor(light);
        const full = formatDate(row.date, props.context.locale, { weekday: "long" });
        return (
          <button key={row.date} type="button" className={"mp-row" + (row.isToday ? " is-today" : "")}
            aria-label={`${full}${row.isToday ? ", today" : ""}: ${body || "nothing planned"}. ${slotLabel}. Open`}
            style={{ background: light }} onClick={() => sheets.openDay(row.date)}>
            <span className="mp-row-day" style={{ background: row.color, color: row.ink }}>{row.label}</span>
            <span className="mp-row-meal" style={{ color: lightInk }}>{body ? <span>{body}</span> : <span className="mp-plan">Plan a meal</span>}</span>
          </button>
        );
      })}
      {rows.length === 0 && <p className="mp-empty">Choose days to show in the planner's settings.</p>}
      {data.error && <p className="mp-status mp-error" role="alert">{data.error}</p>}
      {data.failures.length > 0 && <p className="mp-status mp-error" role="alert">Open the planner to review a change.</p>}
      <div className="mp-card-footer"><Button variant="quiet" onClick={() => props.actions.navigate("/modules/mealplanner")}>Open planner</Button></div>
      <DaySheet props={props} data={data} date={sheets.state.day} onClose={() => sheets.openDay(null)}
        onAdd={(date) => sheets.openEditor({ meal: null, fields: blankFields(data, date, data.settings.cardSlot), back: date })}
        onEdit={(meal) => sheets.openEditor({ meal, fields: data.fieldsOf(meal), back: meal.date })}
        onOpenPlanner={() => props.actions.navigate("/modules/mealplanner")} />
      <MealSheet props={props} data={data} editor={sheets.state.editor} onClose={sheets.closeEditor} onSaved={sheets.closeEditor} />
    </div>
  );
}

function MealRow({ data, meal, onEdit, multiSlot, people }: { data: Data; meal: Meal; onEdit: (meal: Meal) => void; multiSlot: boolean; people: Map<string, string> }) {
  return (
    <li className={"mp-meal" + (meal.status === "cooked" ? " mp-done" : "")}>
      <Checkbox label={mealLabel(meal)} checked={meal.status === "cooked"} disabled={data.busy} onChange={() => void data.toggleCooked(meal)} />
      {multiSlot && <span className="mp-chip">{SLOT_LABELS[meal.slot]}</span>}
      {meal.cookPersonId && people.get(meal.cookPersonId) && <span className="mp-chip">{people.get(meal.cookPersonId)}</span>}
      <button type="button" className="mp-link" aria-label={"Edit " + mealLabel(meal)} onClick={() => onEdit(meal)}>Edit</button>
    </li>
  );
}

function PlannerPage(props: HomiWebModuleSurfaceProps) {
  const data = useMealPlanner(props);
  const sheets = useSheets();
  const [tab, setTab] = useState("planner");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [confirmCopy, setConfirmCopy] = useState(false);
  const [suggestion, setSuggestion] = useState<Idea | null | undefined>(undefined);
  const shown = anchor ?? data.todayDate;
  const dates = weekDates(shown, data.settings.weekStart);
  const people = useMemo(() => new Map(data.people.map((p) => [p.id, p.displayName])), [data.people]);
  const multiSlot = data.settings.slots.length > 1;
  const latest = useRef({ actions: props.actions, today: data.todayDate, data }); latest.current = { actions: props.actions, today: data.todayDate, data };
  useEffect(() => {
    latest.current.actions.registerContextActions({ create: { label: "Add meal", invoke: () => sheets.openEditor({ meal: null, fields: blankFields(latest.current.data, latest.current.today), back: null }) } });
    return () => latest.current.actions.registerContextActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.context.householdId]);
  // A meal chosen in Core's universal search opens once it has loaded.
  const applied = useRef(0);
  useEffect(() => {
    const intent = props.intent;
    if (!intent || applied.current === intent.nonce) return;
    const target = data.meals.find((m) => m.id === intent.params.mealId);
    if (!target) return;
    applied.current = intent.nonce;
    setTab("planner"); setAnchor(target.date);
    sheets.openEditor({ meal: target, fields: data.fieldsOf(target), back: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.intent?.nonce, data.meals]);
  const range = `${formatDate(dates[0]!, props.context.locale, { month: "short", day: "numeric" })} – ${formatDate(dates[6]!, props.context.locale, { month: "short", day: "numeric", year: "numeric" })}`;
  function plan(fields: Partial<MealFields>, date = data.todayDate) {
    sheets.openIdea(null);
    sheets.openEditor({ meal: null, fields: { ...blankFields(data, date), ...fields }, back: null });
  }
  return (
    <section className="mp mp-paper">
      <style>{css}</style>
      <h1 className="mp-title">Meal Planner</h1>
      <Tabs label="Meal Planner views" activeId={tab} onChange={setTab} items={[{ id: "planner", label: "Planner" }, { id: "ideas", label: "Meal ideas" }]} />
      {data.pending > 0 && <p className="mp-status" role="status">{props.context.online ? "Sharing changes…" : "Saved offline. Will share when connected."}</p>}
      {data.error && <p className="mp-error" role="alert">{data.error}</p>}
      <Failures data={data} onReview={(editor) => sheets.openEditor(editor)} />
      {!data.loaded ? <p className="mp-status">Loading the planner…</p> : tab === "planner" ? <>
        <div className="mp-toolbar">
          <Button variant="secondary" aria-label="Previous week" onClick={() => setAnchor(addDays(shown, -7))}>‹</Button>
          <span className="mp-range" role="status" aria-live="polite">{range}</span>
          <Button variant="secondary" aria-label="Next week" onClick={() => setAnchor(addDays(shown, 7))}>›</Button>
          <Button variant="quiet" onClick={() => setAnchor(null)}>Today</Button>
        </div>
        <div className="mp-toolbar">
          <Button onClick={() => plan({}, shown <= data.todayDate && data.todayDate <= dates[6]! ? data.todayDate : dates[0]!)}>Plan a meal</Button>
          <Button variant="secondary" disabled={data.busy} onClick={() => setConfirmCopy(true)}>Copy last week</Button>
          <Button variant="quiet" onClick={() => sheets.openSettings(true)}>Settings</Button>
        </div>
        <div className="mp-days">
          {dates.map((date) => {
            const day = new Date(`${date}T00:00:00Z`).getUTCDay();
            const color = colorFor(data.settings, day);
            const list = mealsOn(data.meals, date);
            return (
              <section key={date} className={"mp-day" + (date === data.todayDate ? " is-today" : "")} aria-label={formatDate(date, props.context.locale, { weekday: "long", month: "long", day: "numeric" })}>
                <h2 className="mp-day-head" style={{ background: color, color: inkFor(color) }}>
                  <span>{formatDate(date, props.context.locale, { weekday: "long" })}{date === data.todayDate ? " · Today" : ""}</span>
                  <span>{formatDate(date, props.context.locale, { month: "short", day: "numeric" })}</span>
                </h2>
                <div className="mp-day-body">
                  {list.length === 0 ? <p className="mp-empty">Nothing planned.</p> : <ul className="mp-ideas">{list.map((meal) => <MealRow key={meal.id} data={data} meal={meal} multiSlot={multiSlot} people={people}
                    onEdit={(m) => sheets.openEditor({ meal: m, fields: data.fieldsOf(m), back: null })} />)}</ul>}
                  <button type="button" className="mp-link" aria-label={`Add a meal on ${formatDate(date, props.context.locale, { weekday: "long" })}`}
                    onClick={() => plan({}, date)}>+ Add meal</button>
                </div>
              </section>
            );
          })}
        </div>
      </> : <>
        <div className="mp-toolbar">
          <Button onClick={() => sheets.openIdea({ idea: null })}>Add an idea</Button>
          <Button variant="secondary" disabled={data.ideas.length === 0} onClick={() => setSuggestion(suggestIdea(data.ideas, data.meals, data.todayDate))}>Suggest something</Button>
        </div>
        {data.ideas.length === 0 ? <p className="mp-status">No ideas yet. Save the meals your household likes, then plan them in a tap.</p>
          : <ul className="mp-ideas" aria-label="Meal ideas">{data.ideas.map((idea) => {
            const last = lastPlanned(data.meals.filter((m) => m.date <= data.todayDate), idea.title);
            return (
              <li key={idea.id} className="mp-idea">
                <div className="mp-idea-main"><strong>{idea.title}</strong>
                  {idea.tags.length > 0 && <div>{idea.tags.map((t) => <span key={t} className="mp-chip" style={{ marginRight: ".3rem" }}>{t}</span>)}</div>}
                  {last && <p className="mp-empty">Last planned {formatDate(last, props.context.locale, { month: "short", day: "numeric" })}</p>}
                </div>
                <Button variant="secondary" onClick={() => plan({ title: idea.title, notes: idea.notes, recipe: idea.recipe })}>Plan it</Button>
                <Button variant="quiet" aria-label={"Edit " + idea.title} onClick={() => sheets.openIdea({ idea })}>Edit</Button>
              </li>
            );
          })}</ul>}
      </>}
      <DaySheet props={props} data={data} date={sheets.state.day} onClose={() => sheets.openDay(null)} onAdd={(d) => plan({}, d)} onEdit={(m) => sheets.openEditor({ meal: m, fields: data.fieldsOf(m), back: null })} />
      <MealSheet props={props} data={data} editor={sheets.state.editor} onClose={sheets.closeEditor} onSaved={sheets.closeEditor} />
      <IdeaSheet data={data} idea={sheets.state.idea?.idea ?? null} open={sheets.state.idea !== null} onClose={() => sheets.openIdea(null)} onPlan={(f) => plan(f)} />
      <SettingsSheet data={data} open={sheets.state.settings} onClose={() => sheets.openSettings(false)} />
      <Dialog portal open={confirmCopy} title="Copy last week?" onDismiss={() => setConfirmCopy(false)}
        actions={<><Button disabled={data.busy} onClick={() => void data.copyWeek(shown).then(() => setConfirmCopy(false))}>Copy meals</Button><Button variant="quiet" onClick={() => setConfirmCopy(false)}>Cancel</Button></>}>
        <p>Meals from the week before are copied onto this week. Days that already have a meal are left alone.</p>
      </Dialog>
      <Dialog portal open={suggestion !== undefined} title="How about…" onDismiss={() => setSuggestion(undefined)}
        actions={<>{suggestion && <Button onClick={() => { const s = suggestion; setSuggestion(undefined); plan({ title: s.title, notes: s.notes, recipe: s.recipe }); }}>Plan it</Button>}
          <Button variant="quiet" onClick={() => setSuggestion(suggestIdea(data.ideas, data.meals, data.todayDate))}>Another</Button>
          <Button variant="quiet" onClick={() => setSuggestion(undefined)}>Close</Button></>}>
        <p>{suggestion ? suggestion.title : "No ideas to suggest yet."}</p>
      </Dialog>
    </section>
  );
}

// Answers Core's universal search from the local working cache, so it also works offline.
const mealSearchProvider: HomiWebModuleSearchProvider = {
  label: "Meals",
  async search(query, { context, actions }) {
    const needle = query.trim().toLocaleLowerCase();
    if (needle === "") return [];
    const records = await actions.listWorkingEntities("meal");
    const todayDate = todayIn(context.timeZone);
    return sortMeals(records.map((row) => parseWorkingMeal(row.data)).filter((m) => !m.deleted && searchText(m).includes(needle)))
      .sort((a, b) => {
        const fa = a.date >= todayDate, fb = b.date >= todayDate;
        return fa === fb ? (fa ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)) : fa ? -1 : 1;
      })
      .map((m) => ({
        id: m.id,
        title: mealLabel(m) || KIND_LABELS[m.kind],
        subtitle: `${formatDate(m.date, context.locale, { weekday: "short", month: "short", day: "numeric" })} · ${SLOT_LABELS[m.slot]}`,
        pageId: "mealplanner",
        intent: { mealId: m.id },
      }));
  },
};

export function createHomiWebModule() {
  return defineHomiWebModule({
    search: mealSearchProvider, moduleKey: MEALPLANNER_MODULE_KEY, moduleApiVersion: HOMI_MODULE_API_VERSION,
    pages: { mealplanner: PlannerPage }, familyBoard: { "weekly-plan": WeeklyPlanCard },
    sync: {
      mutationAdapters: [mealMutationAdapter, ideaMutationAdapter, settingsMutationAdapter],
      changeHandlers: [mealChangeHandler, ideaChangeHandler, settingsChangeHandler],
    },
  });
}
