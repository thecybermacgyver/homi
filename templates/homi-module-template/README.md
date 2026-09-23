# Homi Module Template

This is the authoritative starting point for a first-party, household, or community Homi module.

## Rules

- Do not edit Homi Core to add module business logic.
- Do not import private files from `apps/core`, `apps/web`, or another module.
- Use `@homi/module-sdk` for public module contracts.
- Use `@homi/ui` for normal module UI so the module follows Homi's visual language.
- Keep module-owned database objects inside `mod_<module_key>`.
- Do not create foreign keys or direct SQL dependencies into another module schema.
- Do not register the module directly in `core.modules` or force-enable it in `core.household_modules`; the Homi installer and household module lifecycle own those operations.
- Preserve stable mutation IDs and revision semantics when the module declares synchronized entities.

## Start a new module

Copy this directory, then change these values together:

1. package name in `package.json`.
2. `moduleKey`, name, publisher, description, navigation path, entrypoints, capabilities, and extensions in `homi.module.json`.
3. `STARTER_MODULE_KEY` and route paths in `src/server.ts`.
4. exported web module metadata and UI in `src/web.tsx`.
5. database schema/table names in `migrations/`.
6. localization resources in `locales/`.

For a module key containing hyphens, the database schema uses underscores. Example: `meal-planning` owns `mod_meal_planning`.

## Validate before packaging

Run:

```sh
pnpm manifest:validate
pnpm typecheck
pnpm build
```

A valid template build proves only package/contract compatibility. Installation, household enablement, dynamic web mounting, updates, and recovery are Homi platform responsibilities implemented by later Master Step 5 substeps.
