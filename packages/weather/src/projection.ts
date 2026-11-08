import { FRESH_MS } from "./constants.js";
import type { Forecast, LinkSite, Place, Units } from "./types.js";

// WMO weather codes as Open-Meteo reports them.
const CONDITIONS: ReadonlyArray<{ readonly codes: readonly number[]; readonly text: string; readonly day: string; readonly night: string }> = [
  { codes: [0], text: "Clear", day: "☀️", night: "🌙" },
  { codes: [1], text: "Mostly clear", day: "🌤️", night: "🌙" },
  { codes: [2], text: "Partly cloudy", day: "⛅", night: "☁️" },
  { codes: [3], text: "Cloudy", day: "☁️", night: "☁️" },
  { codes: [45, 48], text: "Fog", day: "🌫️", night: "🌫️" },
  { codes: [51, 53, 55], text: "Drizzle", day: "🌦️", night: "🌧️" },
  { codes: [56, 57], text: "Freezing drizzle", day: "🌧️", night: "🌧️" },
  { codes: [61, 63], text: "Rain", day: "🌧️", night: "🌧️" },
  { codes: [65], text: "Heavy rain", day: "🌧️", night: "🌧️" },
  { codes: [66, 67], text: "Freezing rain", day: "🌧️", night: "🌧️" },
  { codes: [71, 73], text: "Snow", day: "🌨️", night: "🌨️" },
  { codes: [75, 77], text: "Heavy snow", day: "❄️", night: "❄️" },
  { codes: [80, 81], text: "Showers", day: "🌦️", night: "🌧️" },
  { codes: [82], text: "Heavy showers", day: "⛈️", night: "⛈️" },
  { codes: [85, 86], text: "Snow showers", day: "🌨️", night: "🌨️" },
  { codes: [95], text: "Thunderstorm", day: "⛈️", night: "⛈️" },
  { codes: [96, 99], text: "Thunderstorm with hail", day: "⛈️", night: "⛈️" },
];

export function condition(code: number, isDay = true): { readonly text: string; readonly icon: string } {
  const hit = CONDITIONS.find((c) => c.codes.includes(code));
  return hit ? { text: hit.text, icon: isDay ? hit.day : hit.night } : { text: "Unknown", icon: "🌡️" };
}

export function tempValue(celsius: number, units: Units): number {
  return Math.round(units === "imperial" ? (celsius * 9) / 5 + 32 : celsius);
}
export function temp(celsius: number, units: Units): string {
  return `${tempValue(celsius, units)}°`;
}
export function tempUnit(units: Units): string { return units === "imperial" ? "°F" : "°C"; }
export function wind(kmh: number, units: Units): string {
  return units === "imperial" ? `${Math.round(kmh * 0.621371)} mph` : `${Math.round(kmh)} km/h`;
}
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export function compass(degrees: number): string {
  return COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8] ?? "N";
}

// "Ottawa, Ontario" style label for a saved place.
export function placeLabel(place: Pick<Place, "name" | "region" | "country">): string {
  return [place.name, place.region || place.country].filter((part) => part !== "").join(", ");
}

// Where a card or tile opens when it is chosen. All three accept coordinates.
export function forecastLink(site: LinkSite, latitude: number, longitude: number): string {
  const lat = latitude.toFixed(4), lon = longitude.toFixed(4);
  if (site === "yr.no") return `https://www.yr.no/en/forecast/daily-table/${lat},${lon}`;
  if (site === "windy") return `https://www.windy.com/${lat}/${lon}`;
  return `https://weather.com/weather/today/l/${lat},${lon}`;
}

export function ageText(fetchedAt: string, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - new Date(fetchedAt).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
export const isStale = (forecast: Forecast, nowMs: number): boolean => nowMs - new Date(forecast.fetchedAt).getTime() > FRESH_MS;

export function dayName(date: string, locale: string, index: number): string {
  if (index === 0) return "Today";
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale || "en", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)));
}
export function hourName(time: string, locale: string): string {
  const hour = Number(time.slice(11, 13));
  const text = new Intl.DateTimeFormat(locale || "en", { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2000, 0, 1, Number.isFinite(hour) ? hour : 0)));
  // "6 p.m." becomes "6p": short enough to sit in a row of eight.
  return text.replace(/\s*([ap])\.?\s?m\.?/i, (_all, letter: string) => letter.toLowerCase());
}

// Imperial by default only where it is the usual choice.
export function defaultUnits(locale: string): Units {
  return /^en-(US|LR)\b|^my\b/i.test(locale) ? "imperial" : "metric";
}

// Places on Dashboard cards: card N shows the place whose cardSlot is N.
export function placeForSlot(places: readonly Place[], slot: number): Place | null {
  return places.find((p) => p.cardSlot === slot) ?? null;
}
export function sortPlaces(places: readonly Place[]): Place[] {
  return [...places].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}
export function nextPosition(places: readonly Place[]): number {
  return places.reduce((max, p) => Math.max(max, p.position + 1), 0);
}
