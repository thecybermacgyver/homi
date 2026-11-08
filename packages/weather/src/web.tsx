import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defineHomiWebModule, HOMI_MODULE_API_VERSION,
  type HomiWebModuleMutationInput, type HomiWebModuleMutationState, type HomiWebModuleHostActions, type HomiWebModuleSurfaceProps,
} from "@homi/module-sdk";
import { BottomSheet, Button, Dialog, FormField, Select, TextField } from "@homi/ui";
import { Icon, iconFor } from "./art.js";
import { DEFAULT_PREFS, LIMITS, LINK_SITES, REFRESH_MS, WEATHER_MODULE_KEY } from "./constants.js";
import {
  ageText, compass, condition, dayName, defaultUnits, forecastLink, hourName, isStale, nextPosition, placeForSlot, placeLabel,
  sortPlaces, temp, tempUnit, tempValue, wind,
} from "./projection.js";
import {
  parsePlace, parsePrefs, parseWorkingPlace, parseWorkingPrefs, placeChangeHandler, placeMutationAdapter,
  preferencesChangeHandler, preferencesMutationAdapter,
} from "./sync.js";
import { THEMES, themeFor } from "./themes.js";
import type { Forecast, LinkSite, Place, PlaceCandidate, Prefs, PrefsRecord, Units } from "./types.js";

export const css = `
.wx-wrap {color:var(--homi-text);font-size:1rem;display:flex;flex-direction:column}
.wx-wrap h1,.wx-wrap h2,.wx-wrap p {margin:0}
.wx-wrap > .wx {flex:1 0 auto}
/* The card is drawn at one natural size (fixed rem type, a fixed-width icon) and Homi
   scales it to whatever size the member gives the card (fit "scale"), so the icon, the
   temperature and the words always grow and shrink together. Which extra rows appear
   depends on the card's real size, so a small card shows the essentials only. */
.wx {--wx-from:#cfd8de;--wx-to:#b4c2cb;--wx-ink:#14232d;box-sizing:border-box;width:max-content;min-width:100%;position:relative;display:grid;grid-template-columns:minmax(0,7.5rem) auto;justify-content:space-evenly;align-items:center;align-content:center;gap:.4rem 1rem;
  border-radius:22px;padding:1rem 1.2rem;color:var(--wx-ink);text-decoration:none;font:inherit;text-align:left;
  background:linear-gradient(135deg,var(--wx-from),var(--wx-to));box-shadow:0 8px 18px rgba(20,35,45,.22);isolation:isolate}
a.wx:hover {box-shadow:0 10px 22px rgba(20,35,45,.3)}
a.wx:focus-visible {outline:3px solid var(--homi-primary-action);outline-offset:3px}
.wx-icon {width:100%;height:auto;filter:drop-shadow(0 6px 8px rgba(20,35,45,.25))}
.wx-main {display:grid;gap:.15rem;min-width:0;align-content:center}
.wx-temp {font-size:3.6rem;font-weight:300;line-height:1;letter-spacing:-.02em;display:flex;align-items:flex-start}
.wx-deg {font-size:.62em;margin:.04em 0 0 .04em;font-weight:300}
.wx-meta {display:flex;gap:.35rem;align-items:center;font-size:.95rem;white-space:nowrap}
.wx-meta .wx-sep {opacity:.7}
.wx-meta .wx-cond {overflow:hidden;text-overflow:ellipsis}
.wx-drop {width:.8em;height:.8em;flex:none}
.wx-place {max-width:16rem;font-size:1rem;font-weight:500;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;line-height:1.2}
.wx-note {font-size:.78rem;font-style:italic}
.wx-pill {display:none;justify-self:start;margin-top:.35rem;padding:.4rem .95rem;border-radius:999px;font-size:.82rem;font-weight:500;background:color-mix(in srgb,var(--wx-ink) 14%,transparent);white-space:nowrap}
.wx-extra,.wx-hourly,.wx-daily {grid-column:1/-1;display:none;width:0;min-width:100%;box-sizing:border-box}
.wx-extra {font-size:.85rem;gap:.1rem .9rem;flex-wrap:wrap;margin-top:.3rem}
.wx-hourly,.wx-daily {margin:.5rem 0 0;padding:0;list-style:none;gap:.35rem;justify-content:space-between}
.wx-hourly li,.wx-daily li {display:grid;justify-items:center;gap:.1rem;font-size:.78rem;min-width:0;flex:1;white-space:nowrap}
.wx-hourly li span:nth-child(2),.wx-daily li span:nth-child(2) {font-size:1.2rem;line-height:1.1}
.wx-daily li span:last-child {opacity:.85}
@container (min-height:120px) {.wx-pill {display:inline-block}}
@container (min-height:200px) {.wx-extra {display:flex}}
@container (min-height:270px) {.wx-hourly {display:flex}}
@container (min-height:340px) {.wx-daily {display:flex}}
@container (max-width:150px) {.wx {grid-template-columns:1fr}.wx-icon {display:none}}
.wx-page .wx {width:auto;min-width:0;padding:1.2rem 1.4rem;min-height:12rem}
.wx-page .wx-pill,.wx-page .wx-extra,.wx-page .wx-hourly,.wx-page .wx-daily {display:flex}
.wx-page .wx-pill {display:inline-block}
.wx-empty {display:grid;gap:.5rem;align-content:center;justify-items:start}
.wx-empty p {font-size:.95rem;font-weight:500}
.wx-title {font-size:clamp(1.7rem,5vw,2.2rem);font-weight:600;margin:0 0 .8rem!important}
.wx-paper {max-width:60rem;margin:auto;display:grid;gap:1.1rem}
.wx-toolbar {display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.wx-units {display:inline-flex;gap:.25rem}
.wx-units .homi-ui-button[aria-pressed="true"] {box-shadow:inset 0 0 0 2px var(--homi-primary-action);font-weight:700}
.wx-list {list-style:none;margin:0;padding:0;display:grid;gap:1.3rem;grid-template-columns:1fr}
@media (min-width:900px) {.wx-list {grid-template-columns:1fr 1fr}}
.wx-item {display:grid;gap:.5rem}
.wx-controls {display:flex;gap:.6rem;align-items:flex-end;flex-wrap:wrap}
.wx-controls .homi-ui-field {flex:1;min-width:11rem}
.wx-status {font-size:.88rem;color:var(--homi-text-muted);margin:.2rem 0!important}
.wx-error {color:var(--homi-danger);margin:.2rem 0!important}
.wx-failure {border:1px solid var(--homi-danger);border-radius:var(--homi-radius-md);padding:.7rem .9rem;background:var(--homi-danger-soft);display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}
.wx-form {display:grid;gap:.85rem}
.wx-results {list-style:none;margin:0;padding:0;display:grid;gap:.35rem;max-height:18rem;overflow:auto}
.wx-results button {width:100%;text-align:left;border:1px solid var(--homi-border);border-radius:var(--homi-radius-sm);background:var(--homi-surface-strong);color:inherit;padding:.5rem .7rem;min-height:44px;cursor:pointer;font:inherit}
.wx-results button:hover,.wx-results button:focus-visible {background:var(--homi-bg-soft)}
.wx-footer {display:flex;gap:.5rem;justify-content:flex-end;flex-wrap:wrap;margin-top:.3rem}
`;

async function getData(path: string, props: HomiWebModuleSurfaceProps, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch("/api/v1/modules/weather/" + path, {
    credentials: "same-origin",
    headers: { "X-Homi-Household-ID": props.context.householdId, "X-Homi-Client-ID": props.context.clientId },
    ...(signal ? { signal } : {}),
  });
  let body: { data?: unknown; error?: { message?: string } } | null = null;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) throw new Error(body?.error?.message ?? "Weather could not be loaded.");
  return body?.data;
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const round2 = (value: number): number => Math.round(value * 100) / 100;

function readForecast(value: unknown): Forecast | null {
  if (!object(value) || typeof value.fetchedAt !== "string" || typeof value.timezone !== "string") return null;
  const c = value.current;
  if (!object(c) || !finite(c.tempC) || !finite(c.feelsC) || !finite(c.humidity) || !finite(c.windKmh) || !finite(c.windDir) || !finite(c.code) || typeof c.isDay !== "boolean") return null;
  if (!Array.isArray(value.daily) || !Array.isArray(value.hourly) || value.daily.length === 0) return null;
  return value as unknown as Forecast;
}

// ---- Forecasts, cached on the device so a card still works offline ----------

interface Target { readonly key: string; readonly lat: number; readonly lon: number }
interface CachedForecast { readonly forecast: Forecast; readonly lat: number; readonly lon: number }

let cacheChain: Promise<unknown> = Promise.resolve();
function saveForecast(actions: HomiWebModuleHostActions, key: string, record: CachedForecast): void {
  cacheChain = cacheChain.then(async () => {
    const rows = await actions.listCachedEntities("forecast");
    const others = rows.filter((row) => row.entityId !== key).slice(-(LIMITS.places + 2))
      .map((row) => ({ entityId: row.entityId, revision: row.revision, data: row.data }));
    await actions.replaceCachedEntities("forecast", [...others, { entityId: key, revision: "0", data: record }]);
  }).catch(() => undefined);
}

function useForecast(props: HomiWebModuleSurfaceProps, target: Target | null) {
  const latest = useRef(props); latest.current = props;
  const [entry, setEntry] = useState<CachedForecast | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const key = target?.key ?? "", lat = target?.lat ?? 0, lon = target?.lon ?? 0, has = target !== null;
  const online = props.context.online;

  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(id); }, []);

  useEffect(() => {
    if (!has) { setEntry(null); return; }
    let alive = true;
    void latest.current.actions.getCachedEntity("forecast", key).then((row) => {
      if (!alive || !row || !object(row.data)) return;
      const forecast = readForecast(row.data.forecast);
      // A forecast saved for a place that has since moved is not shown.
      if (forecast && finite(row.data.lat) && finite(row.data.lon) && Math.abs(row.data.lat - lat) < 0.03 && Math.abs(row.data.lon - lon) < 0.03) {
        setEntry({ forecast, lat: row.data.lat, lon: row.data.lon });
      } else setEntry(null);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [has, key, lat, lon]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const data = await getData(`forecast?lat=${lat}&lon=${lon}`, latest.current, signal);
    const forecast = readForecast(data);
    if (!forecast) throw new Error("Weather returned an unexpected answer.");
    const record = { forecast, lat, lon };
    setEntry(record); setError("");
    saveForecast(latest.current.actions, key, record);
  }, [key, lat, lon]);

  useEffect(() => {
    if (!has || !online) return;
    const controller = new AbortController();
    const run = () => { if (document.visibilityState === "visible") void load(controller.signal).catch((e) => { if (!controller.signal.aborted) setError(String(e.message ?? e)); }); };
    run();
    const id = window.setInterval(run, REFRESH_MS);
    document.addEventListener("visibilitychange", run);
    return () => { controller.abort(); window.clearInterval(id); document.removeEventListener("visibilitychange", run); };
  }, [has, online, load]);

  return { forecast: entry?.forecast ?? null, error, now };
}

// ---- The device's own location, for the Current card ------------------------

interface Fix { readonly lat: number; readonly lon: number; readonly at: number; readonly name: string; readonly region: string; readonly country: string; readonly approx: boolean }
type FixState = "unsupported" | "idle" | "asking" | "granted" | "approximate" | "error";

function readFix(value: unknown): Fix | null {
  if (!object(value) || !finite(value.lat) || !finite(value.lon) || !finite(value.at)) return null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return { lat: value.lat, lon: value.lon, at: value.at, name: str(value.name), region: str(value.region), country: str(value.country), approx: value.approx === true };
}

// Where this device is. A precise position (GPS or the browser's own location
// service) is used when the device can give one. When it cannot (no GPS, no
// location service, a timeout, or the member said no) the server estimates the
// nearest city from the internet connection instead, and the card says so.
function useDeviceFix(props: HomiWebModuleSurfaceProps) {
  const latest = useRef(props); latest.current = props;
  const [fix, setFix] = useState<Fix | null>(null);
  const [state, setState] = useState<FixState>(typeof navigator !== "undefined" && "geolocation" in navigator ? "idle" : "unsupported");
  const fixRef = useRef<Fix | null>(null); fixRef.current = fix;
  const online = props.context.online;

  useEffect(() => {
    let alive = true;
    void latest.current.actions.getCachedEntity("fix", "last").then((row) => {
      const cached = row ? readFix(row.data) : null;
      if (alive && cached && fixRef.current === null) setFix(cached);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const store = useCallback((next: Fix) => {
    setFix(next);
    void latest.current.actions.replaceCachedEntities("fix", [{ entityId: "last", revision: "0", data: next }]).catch(() => undefined);
  }, []);

  // Ask the server for the nearest city to this connection.
  const approximate = useCallback(async (signal?: AbortSignal) => {
    if (!latest.current.context.online) { setState((current) => (fixRef.current ? current : "error")); return; }
    try {
      const data = await getData("locate", latest.current, signal);
      if (!object(data) || !finite(data.latitude) || !finite(data.longitude) || typeof data.name !== "string") throw new Error("unexpected answer");
      const str = (v: unknown) => (typeof v === "string" ? v : "");
      // A precise fix the device already has is never replaced by an estimate.
      if (fixRef.current && !fixRef.current.approx && Date.now() - fixRef.current.at < REFRESH_MS * 2) return;
      store({ lat: data.latitude, lon: data.longitude, at: Date.now(), name: data.name, region: str(data.region), country: str(data.country), approx: true });
      setState("approximate");
    } catch { if (!signal?.aborted) setState((current) => (fixRef.current ? current : "error")); }
  }, [store]);

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) { void approximate(); return; }
    setState("asking");
    navigator.geolocation.getCurrentPosition((position) => {
      setState("granted");
      const lat = round2(position.coords.latitude), lon = round2(position.coords.longitude);
      const before = fixRef.current;
      const moved = !before || before.approx || Math.abs(before.lat - lat) > 0.04 || Math.abs(before.lon - lon) > 0.04;
      store({ lat, lon, at: Date.now(), name: moved ? "" : before?.name ?? "", region: moved ? "" : before?.region ?? "", country: moved ? "" : before?.country ?? "", approx: false });
    }, () => { void approximate(); },
    { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 8_000 });
  }, [store, approximate]);

  // Ask quietly only when the browser has already been allowed; in every other
  // case show the estimate at once and leave "Use precise location" to a tap.
  useEffect(() => {
    if (!("geolocation" in navigator)) { void approximate(); return; }
    let alive = true;
    const permissions = navigator.permissions;
    if (!permissions?.query) { void approximate(); return; }
    void permissions.query({ name: "geolocation" as PermissionName }).then((status) => {
      if (!alive) return;
      if (status.state === "granted") locate();
      else void approximate();
    }).catch(() => { if (alive) void approximate(); });
    return () => { alive = false; };
  }, [locate, approximate, online]);

  useEffect(() => {
    if (state !== "granted" && state !== "approximate") return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (state === "granted") locate(); else void approximate();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [state, locate, approximate]);

  // Name a precise position once per new position (needs the server, so only online).
  useEffect(() => {
    if (!fix || fix.approx || fix.name !== "" || !online) return;
    const controller = new AbortController();
    void getData(`place-name?lat=${fix.lat}&lon=${fix.lon}`, latest.current, controller.signal).then((data) => {
      if (controller.signal.aborted || !object(data) || typeof data.name !== "string") return;
      const str = (v: unknown) => (typeof v === "string" ? v : "");
      store({ ...fix, name: data.name || "Current location", region: str(data.region), country: str(data.country) });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [fix, online, store]);

  return { fix, state, locate };
}

// ---- The member's saved places and preferences ------------------------------

function useWeather(props: HomiWebModuleSurfaceProps) {
  const latest = useRef(props); latest.current = props;
  const [places, setPlaces] = useState<Place[]>([]);
  const [stored, setStored] = useState<PrefsRecord | null>(null);
  const [mutations, setMutations] = useState<readonly HomiWebModuleMutationState[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const generation = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    const actions = latest.current.actions;
    const [p, s, pending] = await Promise.all([actions.listWorkingEntities("place"), actions.listWorkingEntities("preferences"), actions.listMutations()]);
    if (!active.current || mine !== generation.current) return;
    setPlaces(sortPlaces(p.map((row) => parseWorkingPlace(row.data)).filter((x) => !x.deleted)));
    setStored(s.map((row) => parseWorkingPrefs(row.data))[0] ?? null);
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
      const me = await p.actions.getCachedEntity("profile", "me");
      if (!controller.signal.aborted && me && object(me.data) && typeof me.data.userId === "string") setUserId(me.data.userId);
      if (!p.context.online) return;
      const [placeRows, prefsRow, profile] = await Promise.all([
        getData("places", p, controller.signal), getData("preferences", p, controller.signal), getData("profile", p, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      if (!Array.isArray(placeRows) || !object(profile) || typeof profile.userId !== "string") throw new Error("Invalid Weather response.");
      const parsedPlaces = placeRows.map(parsePlace);
      await p.actions.replaceCachedEntities("place", parsedPlaces.map((x) => ({ entityId: x.id, revision: x.revision, data: x })));
      const parsedPrefs = prefsRow === null ? null : parsePrefs(prefsRow);
      await p.actions.replaceCachedEntities("preferences", parsedPrefs ? [{ entityId: parsedPrefs.id, revision: parsedPrefs.revision, data: parsedPrefs }] : []);
      await p.actions.replaceCachedEntities("profile", [{ entityId: "me", revision: "0", data: { userId: profile.userId } }]);
      if (controller.signal.aborted) return;
      setUserId(profile.userId);
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

  const prefs: Prefs = stored ? { units: stored.units, linkSite: stored.linkSite } : { ...DEFAULT_PREFS, units: defaultUnits(props.context.locale) };

  async function savePrefs(next: Prefs): Promise<boolean> {
    const payload = { units: next.units, linkSite: next.linkSite };
    if (stored) return mutate({ entityType: "preferences", entityId: stored.id, operation: "update", baseRevision: stored.revision, payload });
    if (!userId) { setError("Connect to Homi once to save settings."); return false; }
    return mutate({ entityType: "preferences", entityId: userId, operation: "create", baseRevision: "0", payload });
  }
  const placePayload = (place: Place, patch: Partial<Pick<Place, "cardSlot" | "position">> = {}) => ({
    name: place.name, region: place.region, country: place.country, latitude: place.latitude, longitude: place.longitude,
    cardSlot: place.cardSlot, position: place.position, ...patch,
  });
  async function addPlace(candidate: PlaceCandidate): Promise<"saved" | "duplicate" | "full" | "failed"> {
    if (places.some((p) => Math.abs(p.latitude - candidate.latitude) < 0.02 && Math.abs(p.longitude - candidate.longitude) < 0.02)) return "duplicate";
    if (places.length >= LIMITS.places) return "full";
    const taken = new Set(places.map((p) => p.cardSlot));
    let slot: number | null = null;
    for (let s = 1; s <= LIMITS.cardSlots; s++) if (!taken.has(s)) { slot = s; break; }
    const ok = await mutate({
      entityType: "place", entityId: crypto.randomUUID(), operation: "create", baseRevision: "0",
      payload: { name: candidate.name, region: candidate.region, country: candidate.country, latitude: candidate.latitude, longitude: candidate.longitude, cardSlot: slot, position: nextPosition(places) },
    });
    return ok ? "saved" : "failed";
  }
  // One place per card: giving a card to a place takes it from the one that had it.
  async function assignSlot(place: Place, slot: number | null): Promise<boolean> {
    let ok = true;
    if (slot !== null) {
      for (const other of places.filter((p) => p.id !== place.id && p.cardSlot === slot)) {
        ok = (await mutate({ entityType: "place", entityId: other.id, operation: "update", baseRevision: other.revision, payload: placePayload(other, { cardSlot: null }) })) && ok;
      }
    }
    return (await mutate({ entityType: "place", entityId: place.id, operation: "update", baseRevision: place.revision, payload: placePayload(place, { cardSlot: slot }) })) && ok;
  }
  const removePlace = (place: Place) => mutate({ entityType: "place", entityId: place.id, operation: "delete", baseRevision: place.revision, payload: {} });
  async function dismiss(id: string) {
    try { await latest.current.actions.dismissMutation(id); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  return {
    places, prefs, hasPrefs: stored !== null, loaded, busy, error, userId,
    pending: mutations.filter((m) => m.status === "queued" || m.status === "sending").length,
    failures: mutations.filter((m) => m.status === "conflict" || m.status === "rejected"),
    savePrefs, addPlace, assignSlot, removePlace, dismiss,
  };
}
type Data = ReturnType<typeof useWeather>;

// ---- One weather card -------------------------------------------------------

interface CardView {
  readonly title: string;
  readonly place: string;
  readonly forecast: Forecast | null;
  readonly units: Units;
  readonly href: string | null;
  readonly locale: string;
  readonly nowMs: number;
  readonly offline: boolean;
  readonly approximate?: boolean;
  readonly page?: boolean;
}

// Exported so the cards can be rendered on their own for visual review; Homi loads createHomiWebModule.
export function WxCard({ title, place, forecast, units, href, locale, nowMs, offline, approximate }: CardView) {
  if (!forecast) {
    const theme = THEMES.unknown;
    return (
      <div className="wx" style={{ "--wx-from": theme.from, "--wx-to": theme.to, "--wx-ink": theme.ink } as React.CSSProperties}>
        <div className="wx-empty" style={{ gridColumn: "1 / -1", gridRow: "1 / -1" }}>
          <p>{title}</p>
          <p>{offline ? "No forecast saved yet. It appears once you are online." : "Loading the forecast…"}</p>
        </div>
      </div>
    );
  }
  const c = forecast.current;
  const cond = condition(c.code, c.isDay);
  const theme = THEMES[themeFor(c.code, c.isDay)];
  const tz = forecast.timezone || "UTC";
  let time = "", date = "";
  try {
    time = new Intl.DateTimeFormat(locale || "en", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(nowMs);
    date = new Intl.DateTimeFormat(locale || "en", { month: "short", day: "numeric", year: "numeric", timeZone: tz }).format(nowMs);
  } catch { time = ""; date = ""; }
  const today = forecast.daily[0];
  const chance = today?.precipProb ?? null;
  const age = offline ? `Offline · ${ageText(forecast.fetchedAt, nowMs)}` : isStale(forecast, nowMs) ? `Updated ${ageText(forecast.fetchedAt, nowMs)}` : "";
  const note = [approximate ? "Approximate location" : "", age].filter((part) => part !== "").join(" · ");
  const label = `${place}: ${temp(c.tempC, units)}, ${cond.text}${chance !== null ? `, ${Math.round(chance)}% chance of precipitation` : ""}${note ? `, ${note}` : ""}`;
  const style = { "--wx-from": theme.from, "--wx-to": theme.to, "--wx-ink": theme.ink } as React.CSSProperties;
  const inner = (
    <>
      <Icon kind={iconFor(c.code, c.isDay)} light={theme.light} />
      <span className="wx-main">
        <span className="wx-temp" aria-hidden="true">{tempValue(c.tempC, units)}<span className="wx-deg">{tempUnit(units)}</span></span>
        <span className="wx-meta" aria-hidden="true">
          {chance !== null && <><svg className="wx-drop" viewBox="0 0 10 14" focusable="false"><path d="M5 0 C5 0 0 6 0 9 a5 5 0 0 0 10 0 C10 6 5 0 5 0 Z" fill="currentColor" /></svg><span>{Math.round(chance)}%</span><span className="wx-sep">|</span></>}
          <span className="wx-cond">{cond.text}</span>
        </span>
        <span className="wx-place">{place}</span>
        {note && <span className="wx-note">{note}</span>}
        <span className="wx-pill" aria-hidden="true">See full forecast</span>
      </span>
      <span className="wx-extra">
        {time && <span>Local time {time} · {date}</span>}
        {today && <span>High {temp(today.maxC, units)} · Low {temp(today.minC, units)}</span>}
        <span>Feels like {temp(c.feelsC, units)}</span>
        <span>Wind {wind(c.windKmh, units)} {compass(c.windDir)}</span>
        <span>Humidity {Math.round(c.humidity)}%</span>
      </span>
      <ul className="wx-hourly" aria-label="Next hours">
        {forecast.hourly.slice(0, 8).map((h) => (
          <li key={h.time}><span>{hourName(h.time, locale)}</span><span aria-hidden="true">{condition(h.code, true).icon}</span><span>{temp(h.tempC, units)}</span></li>
        ))}
      </ul>
      <ul className="wx-daily" aria-label="Next days">
        {forecast.daily.slice(0, 5).map((d, i) => (
          <li key={d.date} aria-label={`${dayName(d.date, locale, i)}: high ${temp(d.maxC, units)}, low ${temp(d.minC, units)}, ${condition(d.code, true).text}`}><span aria-hidden="true">{dayName(d.date, locale, i)}</span><span aria-hidden="true">{condition(d.code, true).icon}</span><span aria-hidden="true">{temp(d.maxC, units)}</span><span aria-hidden="true">{temp(d.minC, units)}</span></li>
        ))}
      </ul>
    </>
  );
  return href
    ? <a className="wx" style={style} href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label}. Opens the full forecast in a new tab.`}>{inner}</a>
    : <div className="wx" style={style} role="group" aria-label={label}>{inner}</div>;
}

function Failures({ data }: { data: Data }) {
  return <>{data.failures.map((failure) => (
    <div role="alert" key={failure.clientMutationId} className="wx-failure">
      <span>{failure.errorCode === "WEATHER_PLACE_LIMIT" ? `You can save up to ${LIMITS.places} places.` : failure.status === "conflict" ? "This changed on another device before your change arrived." : "A change could not be saved."}</span>
      <Button variant="quiet" onClick={() => void data.dismiss(failure.clientMutationId)}>Dismiss</Button>
    </div>
  ))}</>;
}

function CurrentCard(props: HomiWebModuleSurfaceProps) {
  const data = useWeather(props);
  const device = useDeviceFix(props);
  const fix = device.fix;
  const target = useMemo<Target | null>(() => (fix ? { key: "current", lat: fix.lat, lon: fix.lon } : null), [fix]);
  const weather = useForecast(props, target);
  const offline = !props.context.online;
  if (!fix) {
    const theme = THEMES.unknown;
    const message = !offline ? (device.state === "error" ? "Your location could not be found. Try again." : "Finding where you are…")
      : "Connect once to find where you are.";
    return (
      <div className="wx-wrap" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <style>{css}</style>
        <div className="wx" style={{ "--wx-from": theme.from, "--wx-to": theme.to, "--wx-ink": theme.ink } as React.CSSProperties}>
          <div className="wx-empty" style={{ gridColumn: "1 / -1", gridRow: "1 / -1" }}>
            <p>Current location</p>
            <p>{message}</p>
            {!offline && <Button variant="secondary" disabled={device.state === "asking"} onClick={device.locate}>{device.state === "asking" ? "Finding you…" : "Try again"}</Button>}
          </div>
        </div>
      </div>
    );
  }
  const place = fix.name ? placeLabel(fix) : "Current location";
  return (
    <div className="wx-wrap" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <style>{css}</style>
      <WxCard title="Current location" place={place} forecast={weather.forecast} units={data.prefs.units} locale={props.context.locale}
        href={forecastLink(data.prefs.linkSite, fix.lat, fix.lon)} nowMs={weather.now} offline={offline} approximate={fix.approx} />
      {data.failures.length > 0 && <p className="wx-status wx-error" role="alert">Open Weather to review a change.</p>}
    </div>
  );
}

function PlaceCard(props: HomiWebModuleSurfaceProps & { slot: number }) {
  const data = useWeather(props);
  const place = placeForSlot(data.places, props.slot);
  const target = useMemo<Target | null>(() => (place ? { key: place.id, lat: place.latitude, lon: place.longitude } : null), [place]);
  const weather = useForecast(props, target);
  return (
    <div className="wx-wrap" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <style>{css}</style>
      {place ? (
        <WxCard title={placeLabel(place)} place={placeLabel(place)} forecast={weather.forecast} units={data.prefs.units} locale={props.context.locale}
          href={forecastLink(data.prefs.linkSite, place.latitude, place.longitude)} nowMs={weather.now} offline={!props.context.online} />
      ) : (
        <div className="wx" style={{ "--wx-from": THEMES.unknown.from, "--wx-to": THEMES.unknown.to, "--wx-ink": THEMES.unknown.ink } as React.CSSProperties}>
          <div className="wx-empty" style={{ gridColumn: "1 / -1", gridRow: "1 / -1" }}>
            <p>{data.loaded ? `Place ${props.slot} has no place yet.` : "Loading…"}</p>
            {data.loaded && <Button variant="secondary" onClick={() => props.actions.navigate("/modules/weather")}>Choose a place</Button>}
          </div>
        </div>
      )}
      {data.failures.length > 0 && <p className="wx-status wx-error" role="alert">Open Weather to review a change.</p>}
    </div>
  );
}

// ---- The Weather page -------------------------------------------------------

function SavedPlace({ props, data, place }: { props: HomiWebModuleSurfaceProps; data: Data; place: Place }) {
  const target = useMemo<Target>(() => ({ key: place.id, lat: place.latitude, lon: place.longitude }), [place]);
  const weather = useForecast(props, target);
  const [confirm, setConfirm] = useState(false);
  const id = `wx-slot-${place.id}`;
  return (
    <li className="wx-item">
      <WxCard title={placeLabel(place)} place={placeLabel(place)} forecast={weather.forecast} units={data.prefs.units} locale={props.context.locale}
        href={forecastLink(data.prefs.linkSite, place.latitude, place.longitude)} nowMs={weather.now} offline={!props.context.online} page />
      <div className="wx-controls">
        <FormField label="Dashboard card" htmlFor={id}>
          <Select id={id} value={place.cardSlot === null ? "" : String(place.cardSlot)} disabled={data.busy}
            onChange={(e) => void data.assignSlot(place, e.currentTarget.value === "" ? null : Number(e.currentTarget.value))}>
            <option value="">Not on the Dashboard</option>
            {Array.from({ length: LIMITS.cardSlots }, (_, i) => <option key={i + 1} value={String(i + 1)}>Place {i + 1}</option>)}
          </Select>
        </FormField>
        <Button variant="danger" disabled={data.busy} onClick={() => setConfirm(true)}>Remove</Button>
      </div>
      {weather.error && !weather.forecast && <p className="wx-status wx-error" role="alert">{weather.error}</p>}
      <Dialog portal open={confirm} title="Remove this place?" onDismiss={() => setConfirm(false)}
        actions={<><Button variant="secondary" onClick={() => setConfirm(false)}>Keep it</Button><Button variant="danger" onClick={() => { setConfirm(false); void data.removePlace(place); }}>Remove</Button></>}>
        <p>{placeLabel(place)} is removed from your saved places and from any Dashboard card.</p>
      </Dialog>
    </li>
  );
}

function AddPlaceSheet({ props, data, open, onClose }: { props: HomiWebModuleSurfaceProps; data: Data; open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceCandidate[] | null>(null);
  const [message, setMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const online = props.context.online;
  useEffect(() => { if (!open) { setQuery(""); setResults(null); setMessage(""); } }, [open]);
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2 || !online) { setResults(null); return; }
    const controller = new AbortController();
    const id = window.setTimeout(() => {
      setSearching(true); setMessage("");
      void getData(`search?q=${encodeURIComponent(q)}`, props, controller.signal).then((rows) => {
        if (controller.signal.aborted) return;
        setResults(Array.isArray(rows) ? (rows as PlaceCandidate[]).filter((r) => object(r) && typeof r.name === "string" && finite(r.latitude) && finite(r.longitude)) : []);
      }).catch((e) => { if (!controller.signal.aborted) setMessage(String(e.message ?? e)); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 350);
    return () => { controller.abort(); window.clearTimeout(id); };
  }, [query, open, online, props]);
  async function choose(candidate: PlaceCandidate) {
    const outcome = await data.addPlace(candidate);
    if (outcome === "saved") onClose();
    else setMessage(outcome === "duplicate" ? "You already saved that place." : outcome === "full" ? `You can save up to ${LIMITS.places} places.` : "That place could not be saved.");
  }
  return (
    <BottomSheet portal open={open} title="Add a place" onDismiss={onClose}>
      <div className="wx-form">
        {!online && <p className="wx-status wx-error" role="status">Searching for places needs a connection.</p>}
        <FormField label="City or place" htmlFor="wx-search">
          <TextField id="wx-search" value={query} maxLength={LIMITS.search} autoComplete="off" placeholder="For example Winnipeg or Heathrow"
            onChange={(e) => setQuery(e.currentTarget.value)} disabled={!online} />
        </FormField>
        {searching && <p className="wx-status" role="status">Searching…</p>}
        {message && <p className="wx-status wx-error" role="alert">{message}</p>}
        {results && results.length === 0 && !searching && <p className="wx-status" role="status">No places found. Try another spelling.</p>}
        {results && results.length > 0 && (
          <ul className="wx-results">
            {results.map((r) => (
              <li key={`${r.latitude},${r.longitude}`}><button type="button" disabled={data.busy} onClick={() => void choose(r)}>{placeLabel(r)}</button></li>
            ))}
          </ul>
        )}
        <div className="wx-footer"><Button variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    </BottomSheet>
  );
}

function SettingsSheet({ data, open, onClose }: { data: Data; open: boolean; onClose: () => void }) {
  const [units, setUnits] = useState<Units>(data.prefs.units);
  const [site, setSite] = useState<LinkSite>(data.prefs.linkSite);
  useEffect(() => { if (open) { setUnits(data.prefs.units); setSite(data.prefs.linkSite); } }, [open, data.prefs.units, data.prefs.linkSite]);
  return (
    <BottomSheet portal open={open} title="Weather settings" onDismiss={onClose}>
      <form className="wx-form" onSubmit={(e) => { e.preventDefault(); void data.savePrefs({ units, linkSite: site }).then((ok) => { if (ok) onClose(); }); }}>
        <FormField label="Temperature and wind" htmlFor="wx-units">
          <Select id="wx-units" value={units} onChange={(e) => setUnits(e.currentTarget.value as Units)}>
            <option value="metric">Celsius (°C) and km/h</option>
            <option value="imperial">Fahrenheit (°F) and mph</option>
          </Select>
        </FormField>
        <FormField label="Open full forecasts on" htmlFor="wx-site">
          <Select id="wx-site" value={site} onChange={(e) => setSite(e.currentTarget.value as LinkSite)}>
            {LINK_SITES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </FormField>
        <p className="wx-status">These settings are yours alone and follow you to your other devices.</p>
        <div className="wx-footer">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={data.busy}>Save</Button>
        </div>
      </form>
    </BottomSheet>
  );
}

function WeatherPage(props: HomiWebModuleSurfaceProps) {
  const data = useWeather(props);
  const device = useDeviceFix(props);
  const fix = device.fix;
  const target = useMemo<Target | null>(() => (fix ? { key: "current", lat: fix.lat, lon: fix.lon } : null), [fix]);
  const weather = useForecast(props, target);
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState(false);
  const latest = useRef({ props, setAdding }); latest.current = { props, setAdding };
  const offline = !props.context.online;
  // Depend only on availability: registering hands back new actions, which would loop.
  useEffect(() => {
    latest.current.props.actions.registerContextActions({ create: { label: "Add a place", available: !offline, invoke: () => latest.current.setAdding(true) } });
    return () => latest.current.props.actions.registerContextActions(null);
  }, [offline]);

  return (
    <div className="wx-wrap wx-page" onKeyDown={(e) => e.stopPropagation()}>
      <style>{css}</style>
      <div className="wx-paper">
        <h1 className="wx-title">Weather</h1>
        <div className="wx-toolbar">
          <Button onClick={() => setAdding(true)} disabled={offline}>Add a place</Button>
          <span className="wx-units" role="group" aria-label="Temperature units">
            <Button variant="secondary" aria-pressed={data.prefs.units === "metric"} disabled={data.busy} onClick={() => { if (data.prefs.units !== "metric") void data.savePrefs({ ...data.prefs, units: "metric" }); }}>°C</Button>
            <Button variant="secondary" aria-pressed={data.prefs.units === "imperial"} disabled={data.busy} onClick={() => { if (data.prefs.units !== "imperial") void data.savePrefs({ ...data.prefs, units: "imperial" }); }}>°F</Button>
          </span>
          <Button variant="secondary" onClick={() => setSettings(true)}>Settings</Button>
          {data.pending > 0 && <span className="wx-status" role="status">{data.pending} change{data.pending === 1 ? "" : "s"} waiting to sync</span>}
        </div>
        {data.error && <p className="wx-status wx-error" role="alert">{data.error}</p>}
        <Failures data={data} />
        <section aria-labelledby="wx-current-title">
          <h2 id="wx-current-title" className="wx-status">Where you are</h2>
          {fix ? (
            <WxCard title="Current location" place={fix.name ? placeLabel(fix) : "Current location"} forecast={weather.forecast} units={data.prefs.units}
              locale={props.context.locale} href={forecastLink(data.prefs.linkSite, fix.lat, fix.lon)} nowMs={weather.now} offline={offline} approximate={fix.approx} page />
          ) : (
            <div className="wx-empty">
              <p>{offline ? "Connect once to find where you are." : device.state === "error" ? "Your location could not be found. Try again." : "Finding where you are…"}</p>
              {!offline && <Button variant="secondary" disabled={device.state === "asking"} onClick={device.locate}>{device.state === "asking" ? "Finding you…" : "Try again"}</Button>}
            </div>
          )}
        </section>
        {fix?.approx && (
          <div className="wx-controls">
            <p className="wx-status">This is an estimate from your internet connection, so it can be a nearby city. Allow location for a precise one.</p>
            <Button variant="secondary" disabled={device.state === "asking"} onClick={device.locate}>{device.state === "asking" ? "Finding you…" : "Use precise location"}</Button>
          </div>
        )}
        <section aria-labelledby="wx-saved-title">
          <h2 id="wx-saved-title" className="wx-status">Your saved places</h2>
          {data.loaded && data.places.length === 0 && <p className="wx-status">Add a place to see its weather here and on your Dashboard.</p>}
          <ul className="wx-list">
            {data.places.map((place) => <SavedPlace key={place.id} props={props} data={data} place={place} />)}
          </ul>
        </section>
      </div>
      <AddPlaceSheet props={props} data={data} open={adding} onClose={() => setAdding(false)} />
      <SettingsSheet data={data} open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}

export function createHomiWebModule() {
  return defineHomiWebModule({
    moduleKey: WEATHER_MODULE_KEY, moduleApiVersion: HOMI_MODULE_API_VERSION,
    pages: { weather: WeatherPage },
    familyBoard: {
      current: CurrentCard,
      "place-1": (props: HomiWebModuleSurfaceProps) => <PlaceCard {...props} slot={1} />,
      "place-2": (props: HomiWebModuleSurfaceProps) => <PlaceCard {...props} slot={2} />,
      "place-3": (props: HomiWebModuleSurfaceProps) => <PlaceCard {...props} slot={3} />,
      "place-4": (props: HomiWebModuleSurfaceProps) => <PlaceCard {...props} slot={4} />,
      "place-5": (props: HomiWebModuleSurfaceProps) => <PlaceCard {...props} slot={5} />,
    },
    sync: {
      mutationAdapters: [placeMutationAdapter, preferencesMutationAdapter],
      changeHandlers: [placeChangeHandler, preferencesChangeHandler],
    },
  });
}
