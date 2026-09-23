# Homi Module Platform Gap Audit

Date: 2026-09-18

Status: Master Step 5.1 corrective platform audit.

This audit compares the implemented repository at checkpoint `016e31f` with the locked platform requirements in `docs/MODULE_PLATFORM_REQUIREMENTS.md` and `docs/DESIGN_SYSTEM_REQUIREMENTS.md`.

## Proven platform foundations already present

The following are real reusable foundations and should be preserved:

- Homi Core authentication and trusted household request context.
- server-authoritative household identity and membership model.
- completed synchronization infrastructure and offline PWA foundation.
- account/household-owned browser persistence.
- generic mutation/change reconciliation infrastructure.
- Core module registry tables:
  - `core.modules`
  - `core.module_versions`
  - `core.household_modules`
- per-module PostgreSQL namespace model `mod_<module_key>`.
- generic server runtime module loading in `apps/core/src/module-host.ts`.
- module API version constant and trusted request context type in `packages/module-sdk`.
- Calendar as an independently built package with a module-owned schema, useful as later reference/conformance work.

These foundations mean the corrective work is platform completion, not a Core rewrite.

## Gap 1 — no complete public module SDK

Observed:

- `packages/module-sdk/src/index.ts` contains only the module API version and `HomiRequestContext`.
- it does not define the manifest, server/client entrypoint contracts, extension contributions, lifecycle, setup/settings, sync registration, localization, broker capabilities, or compatibility helpers required by the locked platform.

Required correction:

- expand the SDK around public, versioned module contracts.
- prevent module authors from importing private Core internals.

## Gap 2 — no authoritative module template

Observed:

- `templates/homi-module-template` does not exist.

Required correction:

- create the public module scaffold.
- prove a second module can be created from it without feature-specific Core/web edits.

## Gap 3 — no shared Homi UI/design-system package

Observed:

- `packages/ui` does not exist.
- Homi shell styling and Calendar styling are maintained directly in `apps/web/src/styles.css`.
- the current stylesheet contains a dark blue/purple shell and a separate light/indigo Calendar workspace, rather than one locked Homi visual language.

Required correction:

- implement `@homi/ui` with semantic tokens/components.
- migrate the Core-owned shell first.
- later migrate Calendar to the same public UI package.

## Gap 4 — Homi application shell is incomplete

Observed:

- authenticated `App.tsx` provides household/context/sync surfaces but not the complete Core-owned Homi shell.
- there is no established generic Home/module navigation/settings structure matching the locked extension-point model.
- Calendar currently occupies the main feature surface directly.

Required correction:

- implement coherent zero-module Home state.
- implement phone bottom navigation and adaptive tablet/desktop shell.
- establish Core-owned Home, Modules, Household, and Settings destinations, with notification/search extension surfaces as their Core contracts become available.

## Gap 5 — web application hard-codes Calendar

Observed:

- `apps/web/src/App.tsx` directly imports `./modules/calendar/CalendarView.js`.
- `apps/web/src/sync/app-sync-runtime.ts` directly imports Calendar mutation/change handlers.
- no generic client module registry such as `apps/web/src/modules/registry.ts` exists.

Required correction:

- build a generic client module host/registry.
- modules register routes/surfaces/navigation/setup/settings/sync contributions through public contracts.
- remove feature-specific Calendar knowledge from the Homi shell/runtime when Calendar is later conformed.

## Gap 6 — no complete Core module-management service/API

Observed:

- `apps/core/src` currently contains no module installer/service or Core module-management route set.
- no `/api/v1/core/modules` management contract is implemented.
- database tables exist, but the product/service lifecycle around them does not.

Required correction:

- implement module catalog/status APIs.
- implement household enable/disable state changes.
- implement installation/update/recovery lifecycle with authorization and audit behavior.

## Gap 7 — runtime loading is deployment configuration, not installation

Observed:

- `apps/core/src/module-host.ts` loads comma-separated `HOMI_MODULE_ENTRYPOINTS`.
- loading a server entrypoint does not itself prove installed-version registry state, manifest compatibility, household enablement, or package integrity.

Required correction:

- make runtime activation agree with authoritative installed module/version state.
- retain generic deployment/runtime loading only as an implementation mechanism behind the real installer/registry contract.

## Gap 8 — Calendar migration acts as installer and household enabler

Observed:

- `packages/calendar/migrations/0000_calendar_initial.sql` inserts directly into `core.modules`.
- it inserts its version directly into `core.module_versions`.
- it inserts/updates `core.household_modules` for every active household with `enabled = true`.

Required correction:

- module-owned migrations must not be the general installation or household enablement mechanism.
- installation belongs to Homi.
- household enablement is an explicit household lifecycle action.
- existing Calendar behavior is preserved only until Calendar is migrated to the finished platform.

## Gap 9 — no user-facing module management

Observed:

- the current Homi UI has no Modules catalog/management surface.
- households cannot generically inspect installed modules, enable/disable them, see version/state, resume setup, or manage update/recovery state.

Required correction:

- implement the Core-owned module management UI using `@homi/ui`.
- make household-specific state visible and actionable according to authorization.

## Gap 10 — incomplete generic setup/settings lifecycle

Observed:

- Calendar implements its own persisted setup/settings flow.
- Core does not yet provide the generic host contract that lets any module declare setup requirements and contribute setup/settings UI dynamically.

Required correction:

- define setup/configured state in the public module contract.
- provide generic shell routing/hosting for module setup and settings.
- keep module-owned configuration data inside the module.

## Gap 11 — update/recovery lifecycle is represented in schema but not complete as a platform

Observed:

- Core schema contains module versions and migration-state fields.
- operations schema includes rollback-related concepts.
- no complete package validation/update/failed-update recovery workflow was found in the Core runtime.

Required correction:

- implement candidate validation, ordered migration, current-version transition, failure state, recoverability/rollback contract, and isolation from unrelated modules.

## Gap 12 — missing proof that Homi works empty

Observed:

- the current app can authenticate and establish household/offline context.
- once ready, it directly attempts to present Calendar when Calendar context exists.
- there is no acceptance fixture proving a household with zero enabled feature modules receives a complete intentional Homi experience.

Required correction:

- add explicit zero-module acceptance coverage before proof-module installation.

## Implementation dependency order

The corrective implementation order is:

1. shared Homi design tokens/components and Core-owned responsive shell.
2. public module manifest/SDK and compatibility model.
3. `homi-module-template`.
4. Core installer/catalog/version lifecycle.
5. household enable/disable/configured-state lifecycle.
6. generic web module registry/extension host and sync contribution registration.
7. independent proof module install/enable/setup/disable/re-enable/update/recovery acceptance.
8. only then refactor Calendar onto the public platform and resume Calendar feature completion.

The design system begins before the module template because the template must consume the established Homi UI contract. The module SDK work may proceed alongside the shell only where contracts are independent, but no proof module is accepted until both are available.

## 5.1 conclusion

The original architectural premise remains sound, but its implementation gate was skipped.

Master Steps 1–4 are retained. Existing Calendar work is retained as reference code. The active roadmap is now Master Step 5 platform completion, and feature-module development remains paused until the platform acceptance proof passes.
