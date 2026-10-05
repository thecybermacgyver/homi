# Homi Meal Planner

Meal Planner is a first-party Homi module: one shared household meal plan.

## Household behavior

- Plan a meal for any day and meal. Dinner is planned by default; Breakfast, Lunch and Snack can be switched on in the planner's settings. A day can have several meals.
- A meal is a meal, eating out, leftovers, takeout or no meal, with a title, notes, servings and who is cooking, and can be marked cooked.
- Repeat a meal every week for 4, 8, 12 or 26 weeks; delete one, or one and all later repeats. Copy a meal to another day, or copy last week into this week (days that already have a meal are left alone).
- Meal ideas: a saved list of dishes with tags and "last planned". "Suggest something" picks one that has not been on the plan lately, and "Plan it" puts it on a day.
- The Dashboard card shows one coloured row per day, in the style of a weekly meal planner. The household chooses any days (this week's chosen days, or the next few from today), the meal shown, Mon or Monday names, and a colour for each day; text colour is set automatically so every colour stays readable. Tap a day to see or change its meals.
- Core's Search finds meals by title, notes and recipe name, and `+` adds a meal.
- Everything works offline and synchronizes through Homi's offline queue. Anyone can edit or remove any meal, since the plan is shared.

## Recipes

Meal Planner never stores recipes. When a module providing the `recipes.lookup.v1` broker capability is installed and enabled, "Choose a recipe" appears in the meal sheet, and the chosen recipe is kept as a snapshot (`id`, `title`, `servings`) so the plan stays correct if that module is later off or removed. Without one, the control is hidden and meals are free text.

### `recipes.lookup.v1` (what a Recipes module provides)

Invoked through the public broker as `host.broker.invoke(context, "recipes.lookup.v1", { action, payload })`:

- `search` with payload `{ query: string, limit: number }` returns an array of `{ id: string, title: string, servings: number | null, minutes: number | null }`. An empty query returns the household's recipes.
- `get` with payload `{ id: string }` returns one `{ id, title, servings, minutes }`, or `null`.

Meal Planner's own endpoints are `GET /api/v1/modules/mealplanner/recipes/status`, `/recipes/search?q=` and `/recipes/:id`.

## Isolation

The module uses only the public `@homi/module-sdk`, `@homi/ui`, host capabilities (`household-people`, `localization`, `sync`), the public broker, and the module-owned `mod_mealplanner` PostgreSQL schema. It does not modify Homi Core, the web shell, or another module.

## Validation

From the repository root:

```sh
pnpm --filter @homi/mealplanner contract:validate
pnpm --filter @homi/mealplanner typecheck
pnpm --filter @homi/mealplanner build
```

Browser acceptance (`qa/acceptance.mjs`) runs only against an isolated localhost stack with a fixture owner, the second fixture member made by `qa/seed-member.mjs`, and the test-only recipes fixture (`qa/recipes-fixture`, never published) standing in for a Recipes module; all data is invented.
