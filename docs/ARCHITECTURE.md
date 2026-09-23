# Homi Architecture

## Product

Homi is a clean-sheet household operating system intended to reduce household coordination and mental load.

Primary capabilities will include:
- unified schedule
- chores/tasks
- grocery, meals, and pantry
- maintenance/assets/service contacts
- secure family vault

The system is phone-first as a PWA, then tablet dashboards, then desktop browsers.

## Core principles

- Homi Core is the stable platform.
- Modules are independently developed, tested, versioned, installed, and updated.
- Modules do not modify Core.
- The server is authoritative.
- Clients synchronize household changes.
- Offline reads and queued writes are Core capabilities.
- Changes must be surfaced to clients in a deterministic way.
- Localization is a Core service, not a manually maintained language-pack dependency.

## Stack

- Node 24
- Fastify 5
- React 19
- Vite 8
- PostgreSQL 18
- Drizzle ORM / migrations
- Better Auth
- Dexie / IndexedDB
- WebSockets
- pg-boss
- Docker Compose

## Repository roles

- `apps/core` — Core HTTP/service runtime
- `apps/web` — PWA/web client
- `packages/db` — database schema and migrations
- `packages/module-sdk` — public module SDK
- `packages/ui` — shared Homi design system and UI primitives (to be implemented in Master Step 5)
- `templates/homi-module-template` — authoritative user/community module scaffold (to be implemented in Master Step 5)

## Database namespaces

Homi uses PostgreSQL schemas:
- `core`
- `auth`
- `jobs`
- `mod_<module_key>`

The `public` schema does not contain Homi application tables. Migration bookkeeping may exist there when required by tooling.

## Identity model

The authenticated account and household person are intentionally separate concepts.

- `core.users` — Homi account-side identity
- `core.household_memberships` — account membership in a household
- `core.household_people` — people belonging to a household, including people who may not have login accounts

Modules reference household people rather than assuming every person is an authenticated account.

## Modules

- Registry is authoritative.
- Homi must function coherently with zero feature modules enabled.
- First-party and user/community modules use the same public module contract.
- Installer validates package integrity, manifests, API compatibility, and migrations before activation.
- Installing a module makes it available; it does not force-enable it for every household.
- Household enable/disable state is server-authoritative and synchronized to clients.
- Each module owns its own `mod_<module_key>` schema.
- No cross-module SQL or foreign keys.
- Core owns authentication, request context, permissions, files, notifications, localization, jobs, auditing, synchronization infrastructure, and the application shell.
- Disabled modules preserve their data and disappear from normal active navigation/behavior.
- Modules that require household/user configuration expose a first-run setup contract. Required setup is persisted by the owning module on the server and must complete before the normal module surface is presented as configured.
- The web shell discovers enabled module contributions generically; it must not hard-code Calendar, Tasks, or any other feature module.
- Module UI contributes only through documented extension points: Home cards/widgets, primary/module navigation, module pages, household settings, notifications, search, and setup/configuration.
- Modules use the shared Homi design system rather than creating private Homi themes.
- The authoritative module scaffold is `homi-module-template`; a module created from it must build and integrate without feature-specific edits to Core or the web shell.
- Full platform acceptance is defined in `docs/MODULE_PLATFORM_REQUIREMENTS.md`.
- Shared visual/interaction acceptance is defined in `docs/DESIGN_SYSTEM_REQUIREMENTS.md`.

## API

Core routes:
`/api/v1/core/...`

Module routes:
`/api/v1/modules/<module-key>/...`

Trusted request context is resolved by Core and includes:
- requestId
- userId
- householdId
- membershipId
- householdPersonId
- optional clientId
- locale
- timeZone

`X-Homi-Household-ID` is a candidate household identifier; Core verifies membership.

`X-Homi-Client-ID` identifies a registered sync client where required.

Browser requests never provide trusted userId, membershipId, permissions, or equivalent authorization claims.

## Synchronization architecture

Server is authoritative.

Synchronizable records use:
- UUID identity
- BIGINT revision
- TIMESTAMPTZ timestamps

State synchronization uses `core.change_log` with a monotonic BIGINT `sequence`. Timestamps are not sync cursors.

Auditing uses `core.audit_log`. Audit and synchronization logs serve different purposes.

Offline mutations:
- have a stable client mutation ID
- are unique by `(client_id, client_mutation_id)`
- carry a base revision
- are idempotent
- return stored replay results
- reject reuse of the same mutation ID with different contents
- return authoritative server state on conflict

Successful mutations:
- apply transactionally
- write audit state
- emit change-log state
- persist mutation result state

Client synchronization model:
1. stable client instance identity
2. register/reuse server-side client ID
3. queue local mutations
4. send mutations idempotently
5. reconcile applied/conflict/rejected results
6. pull changes after the last safely applied sequence
7. apply changes locally
8. advance local/server cursor only after safe local application

BIGINT revisions, sequences, cursors, and base revisions cross HTTP and client storage boundaries as decimal strings to avoid JavaScript precision loss.
