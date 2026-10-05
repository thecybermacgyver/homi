import { DAY_NAMES, DAY_SHORT, DEFAULT_SETTINGS, KIND_LABELS, SLOTS } from "./constants.js";
import { addDays, dayOfWeek, weekDates } from "./dates.js";
import type { Idea, Meal, PlanSettings, Slot } from "./types.js";

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
const DARK = "#2b211c";
const LIGHT = "#fffdf7";
// Text colour with the best contrast on whatever colour a day was given.
export function inkFor(background: string): string {
  const l = luminance(background);
  return contrast(l, luminance(DARK)) >= contrast(l, luminance(LIGHT)) ? DARK : LIGHT;
}

// Mixes a colour toward white; 0 is the colour itself, 1 is white.
export function tint(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const out = (mix((n >> 16) & 255) << 16) | (mix((n >> 8) & 255) << 8) | mix(n & 255);
  return "#" + out.toString(16).padStart(6, "0");
}

export function mealLabel(meal: Pick<Meal, "kind" | "title">): string {
  if (meal.kind === "meal") return meal.title;
  const kind = KIND_LABELS[meal.kind];
  return meal.title ? `${kind} · ${meal.title}` : kind;
}

export function sortMeals(meals: readonly Meal[]): Meal[] {
  return [...meals].sort((a, b) => a.date.localeCompare(b.date)
    || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot)
    || a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function mealsOn(meals: readonly Meal[], date: string, slot?: Slot): Meal[] {
  return sortMeals(meals.filter((m) => m.date === date && (slot === undefined || m.slot === slot)));
}

export function nextPosition(meals: readonly Meal[], date: string, slot: Slot): number {
  return meals.filter((m) => m.date === date && m.slot === slot).reduce((high, m) => Math.max(high, m.position), -1) + 1;
}

export function colorFor(settings: PlanSettings, day: number): string {
  return settings.dayColors[String(day)] ?? DEFAULT_SETTINGS.dayColors[String(day)] ?? "#8a7a6a";
}

export interface CardRow {
  readonly date: string;
  readonly day: number;
  readonly label: string;
  readonly color: string;
  readonly ink: string;
  readonly meals: readonly Meal[];
  readonly isToday: boolean;
}

// The rows the Dashboard card shows. "week" keeps the chosen weekdays of this
// week in their usual places; "upcoming" shows the next few chosen days from
// today, so the card never shows days that are already over.
export function cardRows(settings: PlanSettings, meals: readonly Meal[], todayDate: string): CardRow[] {
  const chosen = new Set(settings.cardDays);
  let dates: string[];
  if (settings.cardMode === "week") {
    dates = weekDates(todayDate, settings.weekStart).filter((d) => chosen.has(dayOfWeek(d)));
  } else {
    dates = [];
    for (let i = 0; i < 366 && dates.length < settings.cardUpcoming && chosen.size > 0; i++) {
      const d = addDays(todayDate, i);
      if (chosen.has(dayOfWeek(d))) dates.push(d);
    }
  }
  return dates.map((date) => {
    const day = dayOfWeek(date);
    const color = colorFor(settings, day);
    return {
      date, day, color, ink: inkFor(color), isToday: date === todayDate,
      label: settings.cardLabel === "long" ? DAY_NAMES[day]! : DAY_SHORT[day]!,
      meals: mealsOn(meals, date, settings.cardSlot),
    };
  });
}

export function cardText(row: CardRow): string {
  if (row.meals.length === 0) return "";
  const first = mealLabel(row.meals[0]!);
  return row.meals.length > 1 ? `${first} +${row.meals.length - 1}` : first;
}

// A saved idea that has not been on the plan lately, picked at random.
export function suggestIdea(ideas: readonly Idea[], meals: readonly Meal[], todayDate: string, random = Math.random()): Idea | null {
  const since = addDays(todayDate, -14);
  const recent = new Set(meals.filter((m) => m.date >= since).map((m) => m.title.trim().toLocaleLowerCase()));
  const fresh = ideas.filter((idea) => !recent.has(idea.title.trim().toLocaleLowerCase()));
  const pool = fresh.length > 0 ? fresh : ideas;
  return pool.length === 0 ? null : pool[Math.min(pool.length - 1, Math.floor(random * pool.length))]!;
}

export function lastPlanned(meals: readonly Meal[], title: string): string | null {
  const key = title.trim().toLocaleLowerCase();
  const dates = meals.filter((m) => m.title.trim().toLocaleLowerCase() === key).map((m) => m.date).sort();
  return dates.length === 0 ? null : dates[dates.length - 1]!;
}

export function searchText(meal: Meal): string {
  return [meal.title, meal.notes, meal.recipe?.title ?? "", KIND_LABELS[meal.kind]].join(" ").toLocaleLowerCase();
}
