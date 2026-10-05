import type { Kind, PlanSettings, Slot } from "./types.js";

export const MEALPLANNER_MODULE_KEY = "mealplanner" as const;
export const MEALPLANNER_VERSION = "0.1.0" as const;
// The one household-wide settings record has a fixed id, so two devices that
// save settings for the first time at once meet on the same record.
export const SETTINGS_ID = "00000000-0000-4000-8000-000000000001" as const;
// Capability a Recipes module provides (actions "search" and "get").
export const RECIPES_CAPABILITY = "recipes.lookup.v1" as const;

export const SLOTS: readonly Slot[] = ["breakfast", "lunch", "dinner", "snack"];
export const SLOT_LABELS: Readonly<Record<Slot, string>> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };
export const KINDS: readonly Kind[] = ["meal", "eating-out", "leftovers", "takeout", "skip"];
export const KIND_LABELS: Readonly<Record<Kind, string>> = {
  meal: "Meal", "eating-out": "Eating out", leftovers: "Leftovers", takeout: "Takeout", skip: "No meal",
};

export const LIMITS = {
  title: 160,
  notes: 2000,
  tags: 10,
  tag: 30,
  repeatWeeks: 26,
} as const;

// Sunday = 0 ... Saturday = 6, as JavaScript counts days.
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const DEFAULT_SETTINGS: PlanSettings = Object.freeze({
  slots: Object.freeze(["dinner"] as Slot[]) as Slot[],
  weekStart: 1,
  cardMode: "week",
  cardDays: Object.freeze([1, 2, 3, 4, 5]) as number[],
  cardUpcoming: 5,
  cardSlot: "dinner",
  cardLabel: "short",
  dayColors: Object.freeze({
    "0": "#7a4f7a", "1": "#b9553f", "2": "#c9753a", "3": "#d9a441", "4": "#5b7357", "5": "#8a9a14", "6": "#3f7a8a",
  }) as Record<string, string>,
}) as PlanSettings;
