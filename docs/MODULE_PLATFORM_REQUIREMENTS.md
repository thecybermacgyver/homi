# Homi Module Platform — Locked Product Requirements

This file is the authoritative acceptance scope for the Homi platform that must exist before first-party feature modules are treated as normal Homi development.

The platform is complete only when Homi can run as a useful empty household operating-system shell and accept an independently packaged module without editing Homi Core or the Homi web application.

## Product boundary

- Homi Core and the Homi application shell must work with zero household feature modules enabled.
- First-party modules and user/community-created modules use the same public module contract.
- First-party status may affect trust/distribution policy, but it must not create a private integration path that bypasses the module platform.
- Feature modules remain independently developed, tested, versioned, installed, updated, enabled, disabled, configured, and removed from active use.
- Disabling a module preserves its data unless an explicit, separate destructive-data operation is performed.
- A household administrator chooses which installed modules are enabled for that household.
- Each signed-in household member independently chooses which enabled/available module cards are visible on their Homi and their display order. Personal presentation changes do not disable the module, remove shared household data, or alter another member's layout.
- Homi must not hard-code Calendar, Tasks, Shopping, Meals, or any other feature module into Core or the application shell.
- Global navigation is Core-owned and does not grow as modules are installed. The primary bottom navigation is exactly `Dashboard`, `Modules`, and `Settings` on every Core and module page. Redundant upper-right Dashboard/Settings controls are not shown. Modules must never append buttons to the global bar.

## Empty Homi acceptance

With no feature modules enabled, a signed-in household must still have a coherent Homi experience that provides at least:

- Homi branding and responsive application shell.
- household selection/context.
- household-level navigation and settings.
- module management.
- connectivity/offline state where relevant.
- synchronization infrastructure.
- notifications/settings entry points as Core capabilities become available.
- a clear empty/home state explaining that modules can be enabled or installed.

An empty Homi must not look broken or unfinished merely because no feature module is enabled.

## Shared Homi design system

Homi owns the visual language. Modules consume it.

The platform must provide the shared, versioned Homi design system defined by `docs/DESIGN_SYSTEM_REQUIREMENTS.md`, including:

- design tokens for color, typography, spacing, radii, elevation, motion, and responsive breakpoints.
- accessible controls and interaction states.
- buttons, inputs, selects, checkboxes, radios, switches, text areas, dialogs/sheets, cards, lists, banners/notices, empty states, loading states, tabs/segmented controls, menus, badges, and navigation primitives.
- layout primitives for phone, tablet/wall display, and desktop.
- module page/surface primitives including standard headers, actions, setup flow, settings surface, and error/conflict states.
- light/dark behavior only if explicitly supported by the Homi design contract; individual modules do not invent independent themes.
- localization-safe layouts and touch targets appropriate for phone-first use.

The Homi shell and the module template must consume the same design-system primitives. A module must not need to recreate the Homi visual language in private CSS.

## Module manifest and compatibility

Every module package must include a machine-validated manifest covering at least:

- stable module key.
- display name.
- publisher.
- module version.
- required Homi module API version/range.
- server entrypoint when the module has server behavior.
- web/client entrypoint when the module has a user interface.
- migrations and owned database schema declaration.
- requested Core capabilities/permissions.
- module-local page/launch metadata. This metadata must not be projected into Homi's Core-owned global navigation bars.
- setup/settings capabilities.
- localization contribution metadata.
- sync entity/mutation registrations when applicable.
- broker capabilities/commands/events when applicable.
- package integrity/digest metadata required by the installer.

Core rejects malformed, incompatible, duplicate, or unauthorized module packages before activation.

## Module package and developer template

Homi must ship the authoritative `homi-module-template` scaffold that users and contributors can copy to create a module.

The template must:

- build independently inside the Homi module toolchain.
- use only documented public module APIs/contracts.
- include a valid manifest.
- include server and/or web entrypoint examples.
- include module-owned migration structure using `mod_<module_key>`.
- demonstrate setup/settings if required.
- demonstrate localization integration.
- demonstrate optional sync registration.
- consume the shared Homi UI package.
- include module-focused typecheck/build/test commands.
- include compatibility tests proving that it does not import private Core internals.

Creating a second module from the template must not require editing Homi Core or hard-coded imports in the Homi web app.

## Installation lifecycle

Homi owns installation. A module migration must not be the installer.

The installer must:

1. inspect the package without activating it.
2. validate the manifest and package integrity.
3. validate API compatibility and module-key ownership/collision rules.
4. validate migration ownership and prohibit cross-module/Core schema modification except through explicitly allowed platform contracts.
5. record installation/version state in the Core registry.
6. apply module-owned migrations transactionally or through a recoverable migration workflow.
7. activate the module runtime only after successful validation/migration.
8. expose failure state without leaving the module falsely presented as healthy/installed.
9. retain enough version/install history for update and rollback behavior.

Installation makes a module available to Homi. It does not automatically force that module enabled for every household.

## Household enable/disable lifecycle

For an installed module:

- each household can independently enable or disable it when policy permits.
- enabled state is authoritative server-side and synchronized to clients.
- enabling a module exposes its module page/UI, Home-card contributions, and module-management entry points only for that household; it does not add a global navigation button.
- required first-run setup is entered before the module is considered configured.
- disabling removes the module from module launch surfaces/Home cards and scheduled active behavior while preserving module data; Core global navigation remains unchanged.
- re-enabling restores access to the preserved module state and resumes setup if setup was incomplete.
- a module cannot make itself enabled for every household merely by running its migration.

## Dynamic web module host

The Homi web application must discover and render enabled modules through a generic module client host.

The host must support, as applicable:

- module web entrypoint loading/registration.
- module route/surface registration.
- household-enabled filtering.
- Homi-owned Family Board surface-type contributions; modules provide card content but do not own an exclusive household position or control board geometry, palette, or shell layout. Core-owned per-member presentation preferences determine whether an available card is shown and its display order.
- module-local page/launch metadata used by the Modules surface, Family Board cards, settings links, and other Homi-owned launch surfaces; modules cannot extend Core global navigation.
- module pages.
- household-settings contribution.
- notifications contribution.
- search contribution.
- setup/configuration contribution.
- sync mutation/change-handler registration.
- localized module labels.
- module loading/error states.
- API compatibility checks.

The Homi app shell must not directly import and render a specific feature module such as Calendar.

## Server module host

The server host remains generic and must enforce the public module boundary.

A runtime module may receive only documented host capabilities/context. It must not depend on private Core implementation modules.

The server host and installer must agree on the authoritative installed/active version rather than relying only on an environment-variable entrypoint list.

## Module setup/settings contract

A module that requires configuration must declare that requirement.

- setup state is owned by the module and persisted server-side.
- Homi can distinguish installed, enabled, configured, disabled, updating, and failed states.
- incomplete setup remains resumable.
- module settings remain editable after setup.
- setup and settings use shared Homi UI patterns.

## Updates and rollback

The module platform must support controlled module version changes.

- validate a candidate update before activation.
- apply versioned migrations in order.
- preserve module data.
- record installed/current version state.
- prevent activation when compatibility validation fails.
- expose failed update state clearly.
- support the defined rollback/recovery contract without pretending destructive database downgrades are always possible.
- keep Core and unrelated modules operating when one module update fails wherever isolation permits.

## Module broker and Core services

Modules do not use direct cross-module SQL, foreign keys, or private imports.

Cross-module behavior uses versioned public contracts such as broker capabilities, commands, events, or read projections.

Core services such as authentication, trusted request context, permissions, files, notifications, localization, jobs, audit, and synchronization remain platform capabilities exposed through documented contracts.

## First-party modules

The initial Homi distribution may ship first-party modules such as Calendar and later Tasks/Chores, Shopping, Meals/Recipes, Pantry, Budget, Family Posts, Home Maintenance, Home Assets, Contacts, and Family Vault.

Shipping with Homi does not mean a household must use them. They remain modules and can be disabled subject to any explicitly documented dependency rules.

## Acceptance proof

The platform is not complete until a clean proof module created from the public template can pass this scenario without feature-specific edits to Homi Core or the Homi web app:

1. Build/package the proof module.
2. Install it through the Homi module lifecycle.
3. Confirm manifest/version/migration registration.
4. See it in Homi's module-management UI.
5. Enable it for one household while it remains disabled for another eligible household/fixture.
6. Complete its setup if it declares required setup.
7. See its module-local launch/page entry appear dynamically through Homi-owned module/Home surfaces while the global bottom bar remains exactly `Dashboard · Modules · Settings`.
8. Open its UI using shared Homi design-system components.
9. Exercise its server/client contract and optional offline/sync path if declared.
10. Disable it and confirm its module launch/Home surfaces and active behavior disappear while its data remains and Core global navigation is unchanged.
11. Re-enable it and confirm preserved state returns.
12. Update it to a second compatible version.
13. Exercise the defined failed-update/recovery or rollback path.
14. Confirm unrelated Homi Core functions and other modules remain unaffected.

Acceptance status: PASSED on 2026-09-19. The public Starter template was exercised through real package installation, registry/migration registration, household-A enablement with household-B isolation, required setup, dynamic runtime/UI, module-owned data and sync/offline behavior, disable/re-enable with preserved state, compatible update to 0.2.0, deliberate failed 0.3.0 migration with transactional rollback, and explicit recovery to the prior applied version. Production Core/Web health, unrelated Calendar registry/enabled state, public runtime bridges, per-member presentation synchronization, and offline/reconnect behavior were also verified.

Calendar can be treated as a normal first-party module only after it conforms to this completed platform. Existing premature Calendar implementation remains reference work for Master Step 6 conformance, not a private integration path.
