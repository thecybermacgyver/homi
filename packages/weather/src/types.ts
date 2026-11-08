export type Units = "metric" | "imperial";
export type LinkSite = "weather.com" | "yr.no" | "windy";

// A place one member saved. Private to that member.
export interface Place {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly country: string;
  readonly latitude: number;
  readonly longitude: number;
  // Which Dashboard card (1 to 5) shows this place, or null for none.
  readonly cardSlot: number | null;
  readonly position: number;
  readonly revision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deleted: boolean;
}

export type PlaceFields = Pick<Place, "name" | "region" | "country" | "latitude" | "longitude" | "cardSlot" | "position">;

export interface Prefs {
  readonly units: Units;
  readonly linkSite: LinkSite;
}

export interface PrefsRecord extends Prefs {
  readonly id: string;
  readonly revision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// What the server returns for one forecast. Always metric: the page converts.
export interface Forecast {
  readonly fetchedAt: string;
  readonly timezone: string;
  readonly current: {
    readonly tempC: number;
    readonly feelsC: number;
    readonly humidity: number;
    readonly windKmh: number;
    readonly windDir: number;
    readonly precipMm: number;
    readonly code: number;
    readonly isDay: boolean;
  };
  readonly daily: readonly { readonly date: string; readonly code: number; readonly maxC: number; readonly minC: number; readonly precipProb: number | null }[];
  readonly hourly: readonly { readonly time: string; readonly tempC: number; readonly code: number; readonly precipProb: number | null }[];
}

export interface PlaceCandidate {
  readonly name: string;
  readonly region: string;
  readonly country: string;
  readonly latitude: number;
  readonly longitude: number;
}
