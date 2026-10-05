export const NOTICEBOARD_MODULE_KEY = "noticeboard" as const;
export const NOTICEBOARD_VERSION = "0.1.0" as const;

export const DEFAULT_COLOR = "#f6dd7a";
// Paper colours offered first; any #rrggbb colour is allowed.
export const SWATCHES = ["#f6dd7a", "#f4ecd2", "#e8a58f", "#b9cfae", "#a9c7d8", "#d9b9d8", "#ffffff"] as const;

export const LIMITS = {
  title: 120,
  body: 4000,
  checklistItems: 50,
  checklistText: 200,
  // A shrunken JPEG as a data URL.
  image: 450_000,
} as const;
