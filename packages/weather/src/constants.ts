import type { LinkSite, Prefs } from "./types.js";

export const WEATHER_MODULE_KEY = "weather" as const;
export const WEATHER_VERSION = "0.1.5" as const;

export const LIMITS = {
  name: 80,
  region: 80,
  country: 80,
  places: 30,
  cardSlots: 5,
  search: 80,
} as const;

export const DEFAULT_PREFS: Prefs = Object.freeze({ units: "metric", linkSite: "weather.com" }) as Prefs;
export const LINK_SITES: readonly { readonly id: LinkSite; readonly label: string }[] = [
  { id: "weather.com", label: "weather.com" },
  { id: "yr.no", label: "yr.no (Norwegian Met Institute)" },
  { id: "windy", label: "Windy" },
];

// Forecasts are cached on the device so a card still shows the last forecast
// offline. Older than this, the card says how old it is.
export const FRESH_MS = 30 * 60 * 1000;
export const REFRESH_MS = 15 * 60 * 1000;
