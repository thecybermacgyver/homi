# Homi Module Authoring

This document describes the public authoring path for Homi feature modules.

The authoritative starter is `templates/homi-module-template`. First-party Homi modules and household/community modules use the same public module contract.

## Public boundaries

A module may depend on:

- `@homi/module-sdk` for Homi module contracts.
- `@homi/ui` for the shared Homi visual and interaction system.
- ordinary third-party packages that are compatible with Homi's runtime and security requirements.

A module must not import private implementation files from:

- `apps/core`
- `apps/web`
- another feature module
- private paths inside Homi packages that are not exported public APIs

Feature modules do not modify Homi Core to add their business logic.

## Manifest

Every module has a `homi.module.json` file validated by `parseHomiModuleManifest()`.

The current manifest schema declares:

- manifest schema version
- stable module key
- display name and publisher
- module version
- required Homi module API version
- server and/or web package entrypoints
- optional module-owned database schema and migration directory
- requested Core capabilities
- requested permissions
- navigation contributions
- setup behavior
- household/user settings behavior
- localization resources
- synchronized entity/operation declarations
- broker capabilities consumed/provided
- Homi-owned Family Board slot/settings/notification/search extension participation

Unknown manifest fields are rejected. This is intentional so spelling mistakes or unsupported contracts cannot silently become deployment behavior.

## Module identity

Module keys:

- are lowercase
- begin with a letter
- contain only lowercase letters, numbers, and hyphens
- are stable once distributed

A module key such as `meal-planning` owns the PostgreSQL schema `mod_meal_planning`.

A module cannot claim `core`, `auth`, `jobs`, another module schema, or arbitrary database namespaces.

## Package paths

Manifest entrypoints, migration directories, and localization resources are package-relative paths beginning with `./`.

Absolute paths and `..` traversal are invalid.

## Database ownership

A database-backed module owns only its declared `mod_<module_key>` schema.

Homi's installer creates the module-owned schema, migration ledger, and runtime database grants.

Module migrations:

- create/change objects only inside the module-owned schema
- do not create, drop, rename, or move schemas
- do not manage roles, grants, ownership, or transaction/search-path state
- do not register themselves in `core.modules`
- do not force-enable themselves in `core.household_modules`
- do not create direct foreign keys or SQL dependencies into another module schema

Homi's installer owns registry/version state. Homi's household module lifecycle owns enable/disable state.

## Server entrypoint

A server module exports a `createHomiServerModule()` entrypoint.

The module definition declares its stable module key and exact supported Homi module API version through the public SDK.

The generic Homi server host provides documented host capabilities through the public SDK. A module must not reach into private Core services.

## Web entrypoint

A web module declares its module key, Homi API version, and page IDs through `defineHomiWebModule()`.

Normal UI uses `@homi/ui` components and semantic tokens so first-party and community modules share the established Homi look.

Homi dynamically mounts enabled web modules from the authoritative installed-module registry. Navigation, setup/settings hosting, Homi-owned Family Board slot placement, and synchronization contribution registration are platform responsibilities; modules provide content and behavior through the public SDK rather than editing the Homi shell.

Module pages may call `actions.registerContextActions()` to contribute Search and Create behavior for the active page. Core owns, positions, labels, and removes the floating controls; the module owns only the callback behavior and current availability. A page must unregister its contextual actions when it unmounts. Modules must not create competing fixed-position Search or Add buttons.

## Setup and settings

If `setup.required` is true, the module owns and persists its setup state. Homi hosts that setup flow and does not present the module as configured until required setup is complete.

A required-setup server module exposes the public `getSetupStatus(context)` callback and returns only `{ state: "configured" }` or `{ state: "unconfigured" }`. The callback is read-only. Core uses it to project household module lifecycle state; it does not move module configuration into Core.

Setup state remains module-owned even while the household disables the module. Disabling a module preserves its schema/data/settings, and Homi may still query the read-only setup-status callback so re-enabling can restore the module without losing configuration.

Household and user settings are declared separately. Module-owned configuration remains in the module's domain/schema.

## Synchronization

A manifest may declare synchronized entity types and the operations they support.

The manifest declaration does not replace implementation. A synchronized module must still use Homi's stable mutation identity, revision, conflict, queue, change-log, and account/household isolation contracts.

## Cross-module integration

Modules do not use direct cross-module SQL or private imports.

Cross-module behavior uses public broker contracts, capabilities, commands, events, or read projections as those contracts are implemented by Homi.

A consumer may call `host.broker.status(context, capability)` before presenting or invoking cross-module behavior. Core returns `available`, `not-installed`, or `not-enabled` plus the provider module key when known. Modules use that structured status to give the household a useful install/enable message; they must not query another module's tables or inspect Core's registry directly.

## Create a module

1. Copy `templates/homi-module-template`.
2. Choose a stable module key.
3. Update `package.json`.
4. Update `homi.module.json`.
5. Update the server/web entrypoints.
6. Rename the module-owned database schema/migrations if the module uses storage.
7. Add localization resources.
8. Implement setup/settings as declared.
9. Implement sync/broker behavior only for capabilities the manifest declares.
10. Validate the package before attempting installation.

## Required local validation

From the module package:

```sh
pnpm manifest:validate
pnpm contract:validate
pnpm typecheck
pnpm build
```

For the Homi repository itself, the full workspace typecheck and build must also remain green before a platform checkpoint.

## Platform separation

A module compiling successfully does not mean it has been installed.

The Homi module platform owns:

- package installation
- registry/version state
- migration execution
- household enable/disable
- setup/configured lifecycle
- dynamic web loading
- Homi-owned Family Board slot placement
- update/recovery
- uninstall/deactivation policy

This separation is deliberate: module authors describe and implement their module; Homi owns deployment and household activation.
