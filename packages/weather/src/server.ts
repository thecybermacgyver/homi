import { isIP } from "node:net";
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
import { LIMITS, WEATHER_MODULE_KEY } from "./constants.js";
import type { Forecast, LinkSite, Place, PlaceCandidate, PlaceFields, Prefs, PrefsRecord, Units } from "./types.js";

// Everything a member saves in this module is private to that member. The
// change feed Core sends to other devices carries only an id, so every read
// below is filtered here, on the server, by who is asking.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function httpError(statusCode: number, code: string, message: string) {
  return Object.assign(new Error(message), { statusCode, code });
}
function invalid(message: string): never {
  throw httpError(400, "WEATHER_INPUT_INVALID", message);
}
const iso = (value: string | Date): string => new Date(value).toISOString();

function headers(request: FastifyRequest) {
  return request.headers as Record<string, string | string[] | undefined>;
}
async function contextFor(host: HomiServerModuleHostContext, request: FastifyRequest): Promise<HomiRequestContext> {
  const context = await host.resolveContext({ id: request.id, headers: headers(request) });
  await host.requireEnabled(WEATHER_MODULE_KEY, context);
  return context;
}

function hasExactly(payload: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const own = Object.keys(payload);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(payload, key));
}
function text(value: unknown, field: string, maximum: number, minimum = 0): string {
  if (typeof value !== "string") invalid(field + " must be text.");
  const result = (value as string).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (result.length < minimum || result.length > maximum) invalid(field + " has an invalid length.");
  return result;
}
function coordinate(value: unknown, field: string, limit: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -limit || value > limit) invalid(field + " is out of range.");
  return Math.round((value as number) * 10000) / 10000;
}

const PLACE_KEYS = ["name", "region", "country", "latitude", "longitude", "cardSlot", "position"];
function parsePlace(payload: Readonly<Record<string, unknown>>): PlaceFields {
  if (!hasExactly(payload, PLACE_KEYS)) invalid("The place payload is invalid.");
  const slot = payload.cardSlot;
  if (!(slot === null || (Number.isInteger(slot) && (slot as number) >= 1 && (slot as number) <= LIMITS.cardSlots))) invalid("cardSlot is invalid.");
  const position = payload.position;
  if (!Number.isInteger(position) || (position as number) < 0 || (position as number) > 1000) invalid("position is invalid.");
  return {
    name: text(payload.name, "name", LIMITS.name, 1),
    region: text(payload.region, "region", LIMITS.region),
    country: text(payload.country, "country", LIMITS.country),
    latitude: coordinate(payload.latitude, "latitude", 90),
    longitude: coordinate(payload.longitude, "longitude", 180),
    cardSlot: slot as number | null,
    position: position as number,
  };
}

const PREFS_KEYS = ["units", "linkSite"];
function parsePrefs(payload: Readonly<Record<string, unknown>>): Prefs {
  if (!hasExactly(payload, PREFS_KEYS)) invalid("The preferences payload is invalid.");
  if (payload.units !== "metric" && payload.units !== "imperial") invalid("units are invalid.");
  if (payload.linkSite !== "weather.com" && payload.linkSite !== "yr.no" && payload.linkSite !== "windy") invalid("linkSite is invalid.");
  return { units: payload.units as Units, linkSite: payload.linkSite as LinkSite };
}

interface PlaceRow extends Record<string, unknown> {
  id: string; userId: string; name: string; region: string; country: string; latitude: number; longitude: number;
  cardSlot: number | null; position: number; revision: string; createdAt: string | Date; updatedAt: string | Date; deletedAt: string | Date | null;
}
interface PrefsRow extends Record<string, unknown> {
  id: string; config: unknown; revision: string; createdAt: string | Date; updatedAt: string | Date;
}
const json = <T>(value: unknown, fallback: T): T => (typeof value === "string" ? (JSON.parse(value) as T) : ((value as T) ?? fallback));

function placeState(row: PlaceRow, deleted = row.deletedAt !== null): Place {
  return Object.freeze({
    id: row.id, name: row.name, region: row.region, country: row.country, latitude: Number(row.latitude), longitude: Number(row.longitude),
    cardSlot: row.cardSlot === null ? null : Number(row.cardSlot), position: Number(row.position),
    revision: row.revision, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), deleted,
  });
}
function prefsState(row: PrefsRow): PrefsRecord & { deleted: false } {
  return Object.freeze({
    ...json<Prefs>(row.config, {} as Prefs), id: row.id, revision: row.revision,
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), deleted: false as const,
  });
}

const placeSelection = `
  id::text AS id, user_id::text AS "userId", name, region, country, latitude, longitude, card_slot AS "cardSlot", position,
  revision::text AS revision, created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"`;
const prefsSelection = `
  id::text AS id, config, revision::text AS revision, created_at AS "createdAt", updated_at AS "updatedAt"`;

type Result = HomiModuleServerMutationResult;
const rejected = (code: string, revision: string | null = null, serverState: unknown = null): Result =>
  ({ status: "rejected", revision, errorCode: code, serverState } as Result);
const conflict = (revision: string, serverState: unknown): Result =>
  ({ status: "conflict", revision, errorCode: "REVISION_CONFLICT", serverState } as Result);

async function applyPlace(context: HomiRequestContext, database: HomiModuleDatabase, input: HomiModuleServerMutationInput): Promise<Result> {
  if (!["create", "update", "delete"].includes(input.operation)) return rejected("WEATHER_OPERATION_UNSUPPORTED");
  const found = await database.query<PlaceRow>(
    `SELECT ${placeSelection} FROM mod_weather.places WHERE household_id = $1::uuid AND id = $2::uuid FOR UPDATE`,
    [context.householdId, input.entityId]);
  const existing = found.rows[0] ?? null;
  // A place that belongs to another member is never revealed: it looks absent.
  const current = existing && existing.userId === context.userId ? existing : null;
  if (existing && !current) return rejected("WEATHER_PLACE_NOT_FOUND");

  if (input.operation === "create") {
    let place: PlaceFields;
    try { place = parsePlace(input.payload); } catch { return rejected("WEATHER_CREATE_INVALID"); }
    if (input.baseRevision !== "0" || current !== null) {
      return current ? conflict(current.revision, placeState(current)) : rejected("WEATHER_CREATE_INVALID");
    }
    const count = await database.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM mod_weather.places WHERE household_id = $1::uuid AND user_id = $2::uuid AND deleted_at IS NULL`,
      [context.householdId, context.userId]);
    if (Number(count.rows[0]?.n ?? "0") >= LIMITS.places) return rejected("WEATHER_PLACE_LIMIT");
    const inserted = await database.query<PlaceRow>(
      `INSERT INTO mod_weather.places (id, household_id, user_id, name, region, country, latitude, longitude, card_slot, position, revision)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, 1) RETURNING ${placeSelection}`,
      [input.entityId, context.householdId, context.userId, place.name, place.region, place.country, place.latitude, place.longitude, place.cardSlot, place.position]);
    const row = inserted.rows[0];
    if (!row) throw new Error("Place insert returned no row.");
    return { status: "applied", revision: row.revision, serverState: placeState(row, false) };
  }
  if (!current || current.deletedAt !== null) return rejected("WEATHER_PLACE_NOT_FOUND", current?.revision ?? null, current ? placeState(current) : null);
  if (current.revision !== input.baseRevision) return conflict(current.revision, placeState(current));

  if (input.operation === "update") {
    let place: PlaceFields;
    try { place = parsePlace(input.payload); } catch { return rejected("WEATHER_UPDATE_INVALID", current.revision, placeState(current)); }
    const updated = await database.query<PlaceRow>(
      `UPDATE mod_weather.places SET name = $4, region = $5, country = $6, latitude = $7, longitude = $8, card_slot = $9, position = $10,
         revision = revision + 1, updated_at = now()
       WHERE household_id = $1::uuid AND user_id = $2::uuid AND id = $3::uuid RETURNING ${placeSelection}`,
      [context.householdId, context.userId, input.entityId, place.name, place.region, place.country, place.latitude, place.longitude, place.cardSlot, place.position]);
    const row = updated.rows[0];
    if (!row) throw new Error("Place update returned no row.");
    return { status: "applied", revision: row.revision, serverState: placeState(row, false) };
  }

  if (Object.keys(input.payload).length !== 0) return rejected("WEATHER_DELETE_INVALID", current.revision, placeState(current));
  const deleted = await database.query<PlaceRow>(
    `UPDATE mod_weather.places SET revision = revision + 1, deleted_at = now(), updated_at = now()
     WHERE household_id = $1::uuid AND user_id = $2::uuid AND id = $3::uuid RETURNING ${placeSelection}`,
    [context.householdId, context.userId, input.entityId]);
  const row = deleted.rows[0];
  if (!row) throw new Error("Place delete returned no row.");
  return { status: "applied", revision: row.revision, serverState: placeState(row, true) };
}

async function applyPrefs(context: HomiRequestContext, database: HomiModuleDatabase, input: HomiModuleServerMutationInput): Promise<Result> {
  if (input.operation !== "create" && input.operation !== "update") return rejected("WEATHER_OPERATION_UNSUPPORTED");
  // A member's preferences always carry that member's own id.
  if (input.entityId !== context.userId) return rejected("WEATHER_PREFERENCES_ID_INVALID");
  const found = await database.query<PrefsRow>(
    `SELECT ${prefsSelection} FROM mod_weather.preferences WHERE household_id = $1::uuid AND user_id = $2::uuid AND id = $2::uuid FOR UPDATE`,
    [context.householdId, context.userId]);
  const current = found.rows[0] ?? null;
  let config: Prefs;
  try { config = parsePrefs(input.payload); } catch {
    return rejected(input.operation === "create" ? "WEATHER_CREATE_INVALID" : "WEATHER_UPDATE_INVALID", current?.revision ?? null, current ? prefsState(current) : null);
  }
  if (input.operation === "create") {
    if (input.baseRevision !== "0" || current !== null) {
      return current ? conflict(current.revision, prefsState(current)) : rejected("WEATHER_CREATE_INVALID");
    }
    const inserted = await database.query<PrefsRow>(
      `INSERT INTO mod_weather.preferences (household_id, user_id, id, config, revision) VALUES ($1::uuid, $2::uuid, $2::uuid, $3::jsonb, 1) RETURNING ${prefsSelection}`,
      [context.householdId, context.userId, JSON.stringify(config)]);
    const row = inserted.rows[0];
    if (!row) throw new Error("Preferences insert returned no row.");
    return { status: "applied", revision: row.revision, serverState: prefsState(row) };
  }
  if (!current) return rejected("WEATHER_PREFERENCES_NOT_FOUND");
  if (current.revision !== input.baseRevision) return conflict(current.revision, prefsState(current));
  const updated = await database.query<PrefsRow>(
    `UPDATE mod_weather.preferences SET config = $3::jsonb, revision = revision + 1, updated_at = now()
     WHERE household_id = $1::uuid AND user_id = $2::uuid AND id = $2::uuid RETURNING ${prefsSelection}`,
    [context.householdId, context.userId, JSON.stringify(config)]);
  const row = updated.rows[0];
  if (!row) throw new Error("Preferences update returned no row.");
  return { status: "applied", revision: row.revision, serverState: prefsState(row) };
}

function idParam(request: FastifyRequest, code: string): string {
  const id = (request.params as { id?: unknown }).id;
  if (typeof id !== "string" || !UUID.test(id)) throw httpError(400, code, "The id must be a UUID.");
  return id;
}

// ---- Outside weather services, called only from this server ---------------
//
// Homi's pages are not allowed to contact other websites, so the server asks
// on their behalf. Only these three fixed hosts are ever contacted; the only
// thing sent is a place name typed into search, or coordinates rounded to two
// decimals (about a kilometre).

const FORECAST_HOST = "api.open-meteo.com";
const GEOCODING_HOST = "geocoding-api.open-meteo.com";
const REVERSE_HOST = "nominatim.openstreetmap.org";
// Where an approximate location comes from when the device cannot give a precise one:
// geojs.io first, ipwho.is as the backup.
const LOCATE_BACKUP_HOST = "ipwho.is";
const LOCATE_HOST = "get.geojs.io";
const USER_AGENT = "Homi-Weather/0.1 (self-hosted household app)";
const FORECAST_TTL_MS = 10 * 60 * 1000;
const NAME_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 400;
const RATE = { windowMs: 60_000, max: 60 } as const;

type Fetcher = (url: URL, init: { signal: AbortSignal; headers: Record<string, string>; redirect: "error" }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

async function upstreamJson(fetcher: Fetcher, url: URL, allowedHost: string): Promise<unknown> {
  if (url.protocol !== "https:" || url.hostname !== allowedHost) throw httpError(500, "WEATHER_UPSTREAM_BLOCKED", "That address is not allowed.");
  let response;
  try {
    response = await fetcher(url, {
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      redirect: "error",
    });
  } catch {
    throw httpError(502, "WEATHER_UPSTREAM_FAILED", "The weather service could not be reached.");
  }
  if (!response.ok) throw httpError(502, "WEATHER_UPSTREAM_FAILED", "The weather service did not answer.");
  const body = await response.text();
  if (body.length > 400_000) throw httpError(502, "WEATHER_UPSTREAM_INVALID", "The weather service answer was too large.");
  try { return JSON.parse(body); } catch { throw httpError(502, "WEATHER_UPSTREAM_INVALID", "The weather service answer was not understood."); }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function normalizeForecast(raw: unknown, now: Date): Forecast {
  const bad = (): never => { throw httpError(502, "WEATHER_UPSTREAM_INVALID", "The weather service answer was not understood."); };
  if (!isObject(raw) || !isObject(raw.current) || !isObject(raw.daily) || !isObject(raw.hourly)) return bad();
  const c = raw.current;
  const tempC = num(c.temperature_2m), feelsC = num(c.apparent_temperature), humidity = num(c.relative_humidity_2m);
  const windKmh = num(c.wind_speed_10m), windDir = num(c.wind_direction_10m), code = num(c.weather_code);
  if (tempC === null || feelsC === null || humidity === null || windKmh === null || windDir === null || code === null || typeof c.time !== "string") return bad();
  const d = raw.daily;
  const dates = arr(d.time), dCode = arr(d.weather_code), dMax = arr(d.temperature_2m_max), dMin = arr(d.temperature_2m_min), dProb = arr(d.precipitation_probability_max);
  const daily: Forecast["daily"][number][] = [];
  for (let i = 0; i < Math.min(dates.length, 7); i++) {
    const date = dates[i], code2 = num(dCode[i]), max = num(dMax[i]), min = num(dMin[i]);
    if (typeof date !== "string" || code2 === null || max === null || min === null) continue;
    daily.push({ date, code: code2, maxC: max, minC: min, precipProb: num(dProb[i]) });
  }
  const h = raw.hourly;
  const times = arr(h.time), hTemp = arr(h.temperature_2m), hCode = arr(h.weather_code), hProb = arr(h.precipitation_probability);
  const hourly: Forecast["hourly"][number][] = [];
  for (let i = 0; i < times.length && hourly.length < 12; i++) {
    const time = times[i], t = num(hTemp[i]), k = num(hCode[i]);
    if (typeof time !== "string" || t === null || k === null || time < c.time.slice(0, 13)) continue;
    hourly.push({ time, tempC: t, code: k, precipProb: num(hProb[i]) });
  }
  if (daily.length === 0) return bad();
  return Object.freeze({
    fetchedAt: now.toISOString(),
    timezone: typeof raw.timezone === "string" ? raw.timezone.slice(0, 60) : "UTC",
    current: Object.freeze({ tempC, feelsC, humidity, windKmh, windDir, precipMm: num(c.precipitation) ?? 0, code, isDay: c.is_day === 1 || c.is_day === true }),
    daily: Object.freeze(daily), hourly: Object.freeze(hourly),
  });
}

function queryNumber(request: FastifyRequest, name: string, limit: number): number {
  const raw = (request.query as Record<string, unknown>)[name];
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value) || value < -limit || value > limit) throw httpError(400, "WEATHER_INPUT_INVALID", `${name} must be a number between -${limit} and ${limit}.`);
  return value;
}
const round2 = (value: number): number => Math.round(value * 100) / 100;

function trim<K, V>(map: Map<K, V>): void {
  while (map.size > CACHE_MAX) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

// The address a request really came from. Cloudflare and the host's nginx put it in
// a header; an address on the household's own network (or this server) cannot be
// placed on a map, so it is not used.
export function isPublicAddress(address: string): boolean {
  let ip = address.trim().toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped?.[1]) ip = mapped[1];
  const kind = isIP(ip);
  if (kind === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (kind === 6) {
    return !(ip === "::1" || ip === "::" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb"));
  }
  return false;
}

export function clientAddress(request: { headers: Record<string, string | string[] | undefined>; ip?: string }): string | null {
  const one = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] ?? "" : value ?? "");
  const candidates = [
    one(request.headers["cf-connecting-ip"]),
    one(request.headers["x-real-ip"]),
    one(request.headers["x-forwarded-for"]).split(",")[0] ?? "",
    request.ip ?? "",
  ].map((value) => value.trim()).filter((value) => value !== "");
  return candidates.find(isPublicAddress) ?? null;
}

export function normalizeApproximate(raw: unknown, source: "ipwho.is" | "geojs"): PlaceCandidate | null {
  if (!isObject(raw)) return null;
  if (source === "ipwho.is" && raw.success !== true) return null;
  const toNumber = (value: unknown): number | null => {
    const n = typeof value === "string" ? Number(value) : value;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  };
  const lat = toNumber(raw.latitude), lon = toNumber(raw.longitude);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const str = (value: unknown, max: number): string => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "");
  const city = str(raw.city, LIMITS.name), region = str(raw.region, LIMITS.region), country = str(raw.country, LIMITS.country);
  const name = city || region || country;
  if (name === "") return null;
  return { name, region: city ? region : "", country, latitude: Math.round(lat * 100) / 100, longitude: Math.round(lon * 100) / 100 };
}

export function createHomiServerModule(host: HomiServerModuleHostContext, options: { fetcher?: Fetcher; now?: () => Date } = {}) {
  const database = host.moduleDatabase;
  const fetcher: Fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const now = options.now ?? (() => new Date());

  const forecasts = new Map<string, { at: number; value: Forecast }>();
  const inflight = new Map<string, Promise<Forecast>>();
  const names = new Map<string, { at: number; value: PlaceCandidate }>();
  const buckets = new Map<string, { start: number; count: number }>();
  const places = new Map<string, { at: number; value: PlaceCandidate }>();
  // Nominatim asks for at most one request a second.
  let reverseChain: Promise<unknown> = Promise.resolve();

  function limited(userId: string): void {
    const at = now().getTime();
    const bucket = buckets.get(userId);
    if (!bucket || at - bucket.start > RATE.windowMs) { buckets.set(userId, { start: at, count: 1 }); trim(buckets); return; }
    bucket.count += 1;
    if (bucket.count > RATE.max) throw httpError(429, "WEATHER_RATE_LIMITED", "Too many weather requests. Try again in a minute.");
  }

  async function forecastFor(lat: number, lon: number): Promise<Forecast> {
    const key = `${round2(lat)},${round2(lon)}`;
    const hit = forecasts.get(key);
    if (hit && now().getTime() - hit.at < FORECAST_TTL_MS) return hit.value;
    const pending = inflight.get(key);
    if (pending) return pending;
    const url = new URL(`https://${FORECAST_HOST}/v1/forecast`);
    url.searchParams.set("latitude", String(round2(lat)));
    url.searchParams.set("longitude", String(round2(lon)));
    url.searchParams.set("current", "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day");
    url.searchParams.set("hourly", "temperature_2m,weather_code,precipitation_probability");
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("forecast_days", "5");
    url.searchParams.set("wind_speed_unit", "kmh");
    const work = upstreamJson(fetcher, url, FORECAST_HOST)
      .then((raw) => normalizeForecast(raw, now()))
      .then((value) => { forecasts.set(key, { at: now().getTime(), value }); trim(forecasts); return value; })
      .finally(() => { inflight.delete(key); });
    inflight.set(key, work);
    return work;
  }

  async function nameFor(lat: number, lon: number): Promise<PlaceCandidate> {
    const key = `${round2(lat)},${round2(lon)}`;
    const hit = names.get(key);
    if (hit && now().getTime() - hit.at < NAME_TTL_MS) return hit.value;
    const run = async (): Promise<PlaceCandidate> => {
      const url = new URL(`https://${REVERSE_HOST}/reverse`);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("lat", String(round2(lat)));
      url.searchParams.set("lon", String(round2(lon)));
      // Zoom 14 names the local community (Scarborough) where zoom 10 names the whole
      // amalgamated city (Toronto), which is where a forecast link for the same
      // coordinates actually goes.
      url.searchParams.set("zoom", "14");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("accept-language", "en");
      const raw = await upstreamJson(fetcher, url, REVERSE_HOST);
      const address = isObject(raw) && isObject(raw.address) ? raw.address : {};
      const pick = (...keys: string[]): string => {
        for (const k of keys) { const v = address[k]; if (typeof v === "string" && v.trim() !== "") return v.trim().slice(0, LIMITS.name); }
        return "";
      };
      const local = pick("hamlet", "village", "town", "suburb", "city_district");
      const city = pick("city", "municipality", "county");
      const name = local || city;
      // "Scarborough, Toronto" names both; a town on its own is placed by its province.
      const region = local && city && local !== city ? city : pick("state", "province", "region");
      const value: PlaceCandidate = { name: name || "Current location", region, country: pick("country"), latitude: round2(lat), longitude: round2(lon) };
      if (name) { names.set(key, { at: now().getTime(), value }); trim(names); }
      return value;
    };
    const next = reverseChain.then(run, run);
    reverseChain = next.then(() => new Promise((r) => setTimeout(r, 1100)), () => new Promise((r) => setTimeout(r, 1100)));
    return next;
  }

  // The nearest city to a connection, for a device that cannot give a precise
  // position (no GPS, no location service, or the member said no). An address on
  // the household's own network is asked about as "this server's own address",
  // which is the household's public connection.
  async function approximate(address: string | null): Promise<PlaceCandidate> {
    const key = address ?? "household";
    const hit = places.get(key);
    if (hit && now().getTime() - hit.at < FORECAST_TTL_MS * 3) return hit.value;
    // geojs.io first: in testing it named the right community where ipwho.is named a
    // larger city nearby; ipwho.is is the backup.
    const main = address === null ? `https://${LOCATE_HOST}/v1/ip/geo.json` : `https://${LOCATE_HOST}/v1/ip/geo/${encodeURIComponent(address)}.json`;
    let found: PlaceCandidate | null = null;
    try { found = normalizeApproximate(await upstreamJson(fetcher, new URL(main), LOCATE_HOST), "geojs"); } catch { found = null; }
    if (!found) {
      const backup = address === null ? `https://${LOCATE_BACKUP_HOST}/` : `https://${LOCATE_BACKUP_HOST}/${encodeURIComponent(address)}`;
      try { found = normalizeApproximate(await upstreamJson(fetcher, new URL(backup), LOCATE_BACKUP_HOST), "ipwho.is"); } catch { found = null; }
    }
    if (!found) throw httpError(502, "WEATHER_LOCATE_FAILED", "Your location could not be estimated from this connection.");
    places.set(key, { at: now().getTime(), value: found });
    trim(places);
    return found;
  }

  async function search(query: string): Promise<PlaceCandidate[]> {
    const url = new URL(`https://${GEOCODING_HOST}/v1/search`);
    url.searchParams.set("name", query);
    url.searchParams.set("count", "8");
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");
    const raw = await upstreamJson(fetcher, url, GEOCODING_HOST);
    const results = isObject(raw) ? arr(raw.results) : [];
    const out: PlaceCandidate[] = [];
    for (const item of results) {
      if (!isObject(item)) continue;
      const lat = num(item.latitude), lon = num(item.longitude);
      if (typeof item.name !== "string" || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
      out.push({ name: item.name.slice(0, LIMITS.name), region: str(item.admin1, LIMITS.region), country: str(item.country, LIMITS.country), latitude: Math.round(lat * 10000) / 10000, longitude: Math.round(lon * 10000) / 10000 });
    }
    return out;
  }

  return defineHomiServerModule({
    moduleKey: WEATHER_MODULE_KEY,
    moduleApiVersion: HOMI_MODULE_API_VERSION,

    register(app: FastifyInstance) {
      app.get("/api/v1/modules/weather/health", async (request) => {
        await contextFor(host, request);
        return { data: { moduleKey: WEATHER_MODULE_KEY, status: "ok" } };
      });

      // The requesting member's own id, which is also the id of their preferences.
      app.get("/api/v1/modules/weather/profile", async (request) => {
        const context = await contextFor(host, request);
        return { data: { userId: context.userId } };
      });

      app.get("/api/v1/modules/weather/places", async (request) => {
        const context = await contextFor(host, request);
        const result = await database.query<PlaceRow>(
          `SELECT ${placeSelection} FROM mod_weather.places
           WHERE household_id = $1::uuid AND user_id = $2::uuid AND deleted_at IS NULL ORDER BY position, created_at`,
          [context.householdId, context.userId]);
        return { data: result.rows.map((row) => placeState(row, false)) };
      });
      app.get("/api/v1/modules/weather/places/:id", async (request) => {
        const context = await contextFor(host, request);
        const result = await database.query<PlaceRow>(
          `SELECT ${placeSelection} FROM mod_weather.places WHERE household_id = $1::uuid AND user_id = $2::uuid AND id = $3::uuid LIMIT 1`,
          [context.householdId, context.userId, idParam(request, "WEATHER_PLACE_ID_INVALID")]);
        const row = result.rows[0];
        if (!row) throw httpError(404, "WEATHER_PLACE_NOT_FOUND", "The place was not found.");
        return { data: placeState(row) };
      });

      // The member's preferences, or null when none have been saved yet.
      app.get("/api/v1/modules/weather/preferences", async (request) => {
        const context = await contextFor(host, request);
        const result = await database.query<PrefsRow>(
          `SELECT ${prefsSelection} FROM mod_weather.preferences WHERE household_id = $1::uuid AND user_id = $2::uuid AND id = $2::uuid LIMIT 1`,
          [context.householdId, context.userId]);
        const row = result.rows[0];
        return { data: row ? prefsState(row) : null };
      });
      app.get("/api/v1/modules/weather/preferences/:id", async (request) => {
        const context = await contextFor(host, request);
        const id = idParam(request, "WEATHER_PREFERENCES_ID_INVALID");
        const result = await database.query<PrefsRow>(
          `SELECT ${prefsSelection} FROM mod_weather.preferences WHERE household_id = $1::uuid AND user_id = $2::uuid AND id = $3::uuid LIMIT 1`,
          [context.householdId, context.userId, id]);
        const row = result.rows[0];
        if (!row) throw httpError(404, "WEATHER_PREFERENCES_NOT_FOUND", "The preferences were not found.");
        return { data: prefsState(row) };
      });

      app.get("/api/v1/modules/weather/forecast", async (request) => {
        const context = await contextFor(host, request);
        limited(context.userId);
        return { data: await forecastFor(queryNumber(request, "lat", 90), queryNumber(request, "lon", 180)) };
      });
      app.get("/api/v1/modules/weather/place-name", async (request) => {
        const context = await contextFor(host, request);
        limited(context.userId);
        return { data: await nameFor(queryNumber(request, "lat", 90), queryNumber(request, "lon", 180)) };
      });
      app.get("/api/v1/modules/weather/locate", async (request) => {
        const context = await contextFor(host, request);
        limited(context.userId);
        const address = clientAddress({ headers: headers(request), ...(typeof request.ip === "string" ? { ip: request.ip } : {}) });
        return { data: { ...(await approximate(address)), approximate: true } };
      });
      app.get("/api/v1/modules/weather/search", async (request) => {
        const context = await contextFor(host, request);
        limited(context.userId);
        const raw = (request.query as { q?: unknown }).q;
        const q = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, "").trim() : "";
        if (q.length < 2 || q.length > LIMITS.search) throw httpError(400, "WEATHER_INPUT_INVALID", "Type at least two letters of a place name.");
        return { data: await search(q) };
      });
    },

    sync: {
      mutationHandlers: [
        { entityType: "place", operations: ["create", "update", "delete"], apply: (context, database, input) => applyPlace(context, database, input) },
        { entityType: "preferences", operations: ["create", "update"], apply: (context, database, input) => applyPrefs(context, database, input) },
      ],
    },
  });
}
