// The look of a weather card follows the weather. Each look is a gradient, a
// text colour and the colours that can sit under text (the "See full forecast"
// pill is the ink at 14% over them). scripts/validate-themes.mjs
// checks every look keeps text at 4.5:1 or better against all of them.

export type ThemeId =
  | "clear-day" | "clear-night" | "cloudy-day" | "cloudy-night" | "rain" | "storm" | "snow" | "heavy-snow" | "fog" | "unknown";

export interface WeatherTheme {
  readonly id: ThemeId;
  readonly from: string;
  readonly to: string;
  readonly ink: string;
  // A light card gets a white cloud, a dark card a pale blue one.
  readonly light: boolean;
  // Every colour that can end up behind text: the two ends of the gradient.
  readonly zone: readonly string[];
}

export const THEMES: Readonly<Record<ThemeId, WeatherTheme>> = Object.freeze({
  "clear-day": { id: "clear-day", from: "#ff8a6b", to: "#ffb347", ink: "#3a1206", light: true, zone: ["#ff8a6b", "#ffb347"] },
  "clear-night": { id: "clear-night", from: "#0d2547", to: "#1c4377", ink: "#ffffff", light: false, zone: ["#0d2547", "#1c4377"] },
  "cloudy-day": { id: "cloudy-day", from: "#9fd0f2", to: "#6fb6e0", ink: "#0b2a45", light: true, zone: ["#9fd0f2", "#6fb6e0"] },
  "cloudy-night": { id: "cloudy-night", from: "#16294a", to: "#274a78", ink: "#ffffff", light: false, zone: ["#16294a", "#274a78"] },
  rain: { id: "rain", from: "#3b5268", to: "#4a6279", ink: "#ffffff", light: false, zone: ["#3b5268", "#4a6279"] },
  storm: { id: "storm", from: "#1f2a38", to: "#33445a", ink: "#ffffff", light: false, zone: ["#1f2a38", "#33445a"] },
  snow: { id: "snow", from: "#d3e6f6", to: "#a9c9e6", ink: "#0f2c47", light: true, zone: ["#d3e6f6", "#a9c9e6"] },
  "heavy-snow": { id: "heavy-snow", from: "#dcebf6", to: "#b9d4e9", ink: "#0f2c47", light: true, zone: ["#dcebf6", "#b9d4e9"] },
  fog: { id: "fog", from: "#c3ced5", to: "#a4b4bf", ink: "#14232d", light: true, zone: ["#c3ced5", "#a4b4bf"] },
  unknown: { id: "unknown", from: "#cfd8de", to: "#b4c2cb", ink: "#14232d", light: true, zone: ["#cfd8de", "#b4c2cb"] },
});

export function themeFor(code: number, isDay: boolean): ThemeId {
  if (code === 0 || code === 1) return isDay ? "clear-day" : "clear-night";
  if (code === 2 || code === 3) return isDay ? "cloudy-day" : "cloudy-night";
  if (code === 45 || code === 48) return "fog";
  if (code === 75 || code === 77) return "heavy-snow";
  if (code === 71 || code === 73 || code === 85 || code === 86) return "snow";
  if (code === 95 || code === 96 || code === 99) return "storm";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  return "unknown";
}
