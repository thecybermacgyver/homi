export type Slot = "breakfast" | "lunch" | "dinner" | "snack";
export type Kind = "meal" | "eating-out" | "leftovers" | "takeout" | "skip";

// A recipe chosen from a Recipes module. Only a snapshot is kept, so the plan
// stays correct if that module is off, updated or removed.
export interface RecipeRef {
  readonly id: string;
  readonly title: string;
  readonly servings: number | null;
}

export interface Meal {
  readonly id: string;
  readonly date: string; // YYYY-MM-DD
  readonly slot: Slot;
  readonly kind: Kind;
  readonly title: string;
  readonly notes: string;
  readonly servings: number | null;
  readonly cookPersonId: string | null;
  readonly status: "planned" | "cooked";
  readonly recipe: RecipeRef | null;
  readonly position: number;
  readonly seriesId: string | null;
  readonly revision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deleted: boolean;
}

export type MealFields = Pick<Meal, "date" | "slot" | "kind" | "title" | "notes" | "servings" | "cookPersonId" | "status" | "recipe" | "position" | "seriesId">;

export interface Idea {
  readonly id: string;
  readonly title: string;
  readonly notes: string;
  readonly tags: readonly string[];
  readonly recipe: RecipeRef | null;
  readonly revision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deleted: boolean;
}

export type IdeaFields = Pick<Idea, "title" | "notes" | "tags" | "recipe">;

// Household-wide plan and Dashboard card settings.
export interface PlanSettings {
  readonly slots: Slot[];
  readonly weekStart: number;
  readonly cardMode: "week" | "upcoming";
  readonly cardDays: number[];
  readonly cardUpcoming: number;
  readonly cardSlot: Slot;
  readonly cardLabel: "short" | "long";
  readonly dayColors: Record<string, string>;
}

export interface SettingsRecord extends PlanSettings {
  readonly id: string;
  readonly revision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
