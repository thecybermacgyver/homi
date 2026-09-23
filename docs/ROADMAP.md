# Homi Master Roadmap

Roadmap corrected 2026-09-18 by explicit product-direction decision: Homi itself must be a complete empty platform, design system, and module host before feature-module development is treated as the active roadmap. Do not renumber these corrected Master Steps without a later explicit decision.

Publication decision 2026-09-23: Homi is licensed under AGPL-3.0 and released from a clean public snapshot. Private deployment domains, credentials, data, backup records, and internal engineering history remain private.

1. Product framing — COMPLETE
2. UX targets — COMPLETE
3. Smallest Core — COMPLETE
4. Synchronization — COMPLETE
5. Homi application shell, design system, and module platform — COMPLETE
6. First-party Calendar module — COMPLETE; Calendar 0.6.9 is validated and deployed through the managed module lifecycle
7. Calendar multi-device test — COMPLETE
8. Expand first-party/community modules — COMPLETE for the first public release; Chequebook 0.1.12 and Calendar 0.6.9 are validated, installed, enabled, and connected through gated public broker contracts; Core-owned contextual Search/Add, generic missing-capability status, and the signed private-GitHub directory with isolated backup-first admin installation are implemented

## Master Step 5 — Homi platform progress

- 5.1 Platform acceptance contract and gap inventory — COMPLETE
- 5.2 Shared Homi design system and responsive application shell — COMPLETE
- 5.3 Public module manifest, SDK, compatibility contract, and developer template — COMPLETE
- 5.4 Module installer, version registry, migrations, update/recovery lifecycle — COMPLETE
- 5.5 Household module enable/disable/configuration lifecycle — COMPLETE
- 5.6 Dynamic web module host, navigation, setup/settings, Family Board slots, and sync contribution registry — COMPLETE
- 5.7 Independent proof-module acceptance with no Core/web feature-specific edits — COMPLETE

The locked acceptance scope for Master Step 5 is `docs/MODULE_PLATFORM_REQUIREMENTS.md`; the shared visual contract is `docs/DESIGN_SYSTEM_REQUIREMENTS.md`; the source-verified corrective inventory is `docs/MODULE_PLATFORM_GAP_AUDIT.md`. The Step 5 platform gate has passed. A first-party module uses the same public SDK, manifest, design-system, host, installer, synchronization, and offline contracts as a user/community-created module; first-party status does not permit hard-coded Core or web integration. Installation and household enablement determine household capability availability. Each signed-in household member independently chooses which available module cards are visible on their Homi and their display order; those preferences synchronize through the existing Homi offline/sync system without changing another member's layout or disabling shared module data.

## Master Step 6 — Calendar 0.6.1 — COMPLETE

Calendar conforms to the managed module platform at corrective version 0.6.1. Local PostgreSQL and phone-browser acceptance prove managed installation/migration, Homi UI integration, three Family Board cards, automatic offline/reconnect synchronization, remembered Day/Week/Month/Upcoming view state, recurrence and occurrence overrides, reminders/people/transport/search, external calendar and ICS support, phone-first calendar layout, per-event 16-color storage/rendering/synchronization, race-safe starter-calendar initialization, production-shaped legacy-schema reconciliation, and all-day event storage. The permanent 0.4→0.6.1 conformance validator passes with `legacy-schema-reconciled=yes` and `all-day=yes`. Production was backed up before change; the failed immutable 0.6.0 candidate was recovered to 0.5.0, 0.6.1 then installed transactionally with only `0005_event_colors.sql`, existing Calendar fingerprints remained identical, Core/Web were promoted to the validated images, the public 0.6.1 web asset and Calendar routes are live, service worker v2 and runtime bridges are current, and sustained health/restart/error/source-consistency checks pass. Master Step 7 remains pending while the explicitly requested Chequebook slice proceeds under Master Step 8.

The customized OpenFamily installation is an explicit functional parity floor for Homi. The authoritative parity inventory is `docs/OPENFAMILY_PARITY_REQUIREMENTS.md`. Parity is functional rather than architectural: Homi must preserve the user capability while translating cross-feature behavior to SDK/broker/Core contracts. Chequebook 0.1.1 declares the Calendar broker consumer contract; user-owned setup is complete, while end-user Calendar-linkage acceptance remains a separate pending integration check.

## Master Step 8 — First-party/community module expansion — IN PROGRESS

The signed GitHub module directory is now wired into the Modules page and the isolated internal manager. Admins can install/update a verified immutable release independently of household enablement; the manager creates a database-and-artifact recovery set first, and the existing installer provides transactional rollback. Production deployment and end-to-end acceptance of this path pass. The first public-release gates—module lifecycle, multi-device synchronization, offline/PWA behavior, security, accessibility, clean installation, recovery, and owner approval—are complete. Additional modules continue as post-release expansion.

Chequebook 0.1.1 is the first Step 8 module slice. It is an independently packaged managed module covering accounts/opening balances, income/expenses/transfers, cleared and reconciled state, recurring items, forecasts, category limits/alerts/analytics, Calendar broker linkage, three Family Board cards, and offline synchronization adapters. The permanent real PostgreSQL gate passes install, setup, mutation replay/conflict behavior, recurring/budget/forecast behavior, disable/re-enable preservation, Home cards, and the web contract. Production backups were validated before installation and again before 0.1.1 at `20260920-203331`; the current managed artifact digest is `sha256:385ddc0ff45b002efbb7b96e7c688b82ab0641d53bd8a78f103a8128596c3fb3`; the module is installed and enabled for `OurHome` at revision 1; and promoted Core image `sha256:49be37232253df0eb902a8d1acc58a6befad1c948be8bcb708c173ab09bb4eae` is healthy. User-owned initial setup is complete. Version 0.1.1 places recurrence selection directly in Add/Edit Transaction with daily, weekly, monthly, yearly, interval, and optional end-date controls while retaining the Recurring management tab; real PostgreSQL acceptance proves transaction recurrence attachment/detachment.

## Historical premature Calendar implementation

The following labels describe already-completed or in-progress Calendar work created before the missing Homi platform gate was recognized. They are retained for engineering continuity and are not active Master Step 5 substeps.

- 5.1 Calendar server/module foundation — COMPLETE
- 5.2 Calendar browser/offline sync and mobile UI — COMPLETE
- 5.3 Calendar deployment correction and module setup contract — COMPLETE
- 5.4 Calendar layers, settings and expanded event model — COMPLETE
- 5.5 Responsive Day/Week/Month/Upcoming calendar experience — COMPLETE
- 5.6 Recurrence, reminders, people/context and search — IN PROGRESS
- 5.7 External calendar sync, ICS/sharing and broker integrations — NOT STARTED
- 5.8 Full single-device Calendar acceptance — NOT STARTED

5.1 adds the independently built `@homi/calendar` package with its own
`mod_calendar` schema, migration history, module/version registration, household
enablement, event service, HTTP routes, optimistic revision checks, mutation
idempotency/replay, change-log emission, audit records, and event-outbox records.
Core does not import Calendar directly: a generic `HOMI_MODULE_ENTRYPOINTS` runtime
loader provides the module host boundary and Calendar is selected only by deployment
configuration. An isolated PostgreSQL 18.6 integration test proved migration and
create/replay/mutation-ID-reuse/conflict/update/delete semantics plus change-log,
audit, and outbox effects. Full repository build and route validation passed.

5.2 extends the module-neutral browser sync runtime with a mutation-adapter registry and
registers Calendar create/update/delete delivery plus a Calendar change materializer. Calendar
changes are cached in the existing account/household-owned IndexedDB store, and local Calendar
writes queue while offline. Never-dispatched Calendar edits are safely coalesced in place; once
a mutation may have reached the server its identity/request is immutable. The mobile-first
Calendar UI renders cached and optimistic events, supports create/edit/delete, shows pending
sync state and terminal conflicts/rejections, and remains usable from the last validated
offline household context. Focused fake-IndexedDB/fetch/runtime tests proved cache reads,
adapter dispatch, historical-delete catch-up, offline create/edit/delete coalescing, and an
end-to-end offline create -> delivery -> change pull -> cache reconciliation cycle.

## Master Step 4 validated progress

- 4.1 Synchronization protocol — COMPLETE
- 4.2 Client registration and sync identity — COMPLETE
- 4.3 Change-log emission — COMPLETE
- 4.4 Pull change feed — COMPLETE
- 4.5 Sync cursor persistence — COMPLETE
- 4.6 Mutation idempotency and conflict handling — COMPLETE
- 4.7 Conflict recovery payload — COMPLETE
- 4.8A Client offline sync storage foundation — COMPLETE
- 4.8B Client sync identity initialization — COMPLETE
- 4.8C Client authenticated sync context resolution — COMPLETE
- 4.8D Authenticated household discovery contract — COMPLETE
- 4.8E Browser authenticated household discovery adapter — COMPLETE
- 4.8F Account-owned cancellable client registration primitive — COMPLETE
- 4.8G In-memory session generation and stale-result adoption guard — COMPLETE
- 4.8H In-memory household selection and context eligibility contract — COMPLETE
- 4.8I Explicit in-memory sync context coordinator — COMPLETE
- 4.8J Explicit cancellable mutation submission primitive — COMPLETE
- 4.8K Account-owned local sync storage isolation — COMPLETE
- 4.8L Durable queued mutation delivery and result recording — COMPLETE
- 4.8M Cancellable change-feed and cursor protocol adapters — COMPLETE
- 4.8N Authoritative household settings snapshot adapter — COMPLETE
- 4.8O Durable pull/materialize/apply/cursor reconciliation — COMPLETE
- 4.8P Explicit serialized synchronization cycle coordinator — COMPLETE
- 4.8Q Browser application sync lifecycle integration — COMPLETE
- 4.8R Installable offline application shell and durable offline context — COMPLETE

4.8B connects the validated storage identity to authenticated Core client
registration through a single explicit invocation. It validates the returned
identity before persisting the server client ID. Runtime integration, concurrent
initialization, queue recovery, mutation delivery, and pull/cursor work are excluded.
Actual application lifecycle invocation belongs to later synchronization runtime work.

4.8C adds one explicit context request for a supplied household and registered
client. It validates the server context without persisting it. Lifecycle
integration, household selection, persistence, and all queue, cache, mutation,
pull, and cursor work remain for later synchronization substeps.

4.8D adds session-authenticated discovery of context-eligible household candidates,
ordered by name and UUID. Discovery does not select a household or grant ongoing
authorization. Browser integration, household selection, registration/context
orchestration, persistence, and synchronization runtime remain deferred.

4.8E adds one explicitly invoked, cancellable browser adapter for the existing
Better Auth session and household discovery contracts. It interprets Better Auth
session state, consumes `GET /api/v1/core/households`, and returns validated
in-memory identity and household candidates without persistence or household
selection. Account-owned registration and session adoption guards are now implemented in
4.8F–4.8G. Explicit discovery/registration/context orchestration is implemented in 4.8I;
application lifecycle integration and queue/cache/pull/mutation runtime remain deferred.

4.8F adds an account-owned, cancellable client registration primitive. Core
registration returns its server-authenticated `authSubject`; `initializeClient()`
requires an expected subject and persists a returned client ID only when Core
proves that subject matches. The browser-installation `clientInstanceId` remains
global, while client ID persistence is account-owned and the legacy global
`clientId` metadata is ignored. No household selection or lifecycle orchestration
is introduced. Session-generation and stale-result adoption guards are now implemented in
4.8G, with in-memory household selection in 4.8H. Explicit discovery/registration/
context orchestration is implemented in 4.8I;
logout/account-switch application lifecycle wiring and synchronization runtime remain deferred.

4.8G provides a factory-created in-memory session-check and stale-result adoption
guard with no singleton. It creates pre-async session-check handles, accepts only
the latest check, keeps its session-check signal separate from authenticated
generation signals, and binds operation handles to generation, `authSubject`, and
`sessionId` for current-state validation. New session IDs, account changes,
unauthenticated transitions, and explicit invalidation abort prior generations;
foreign and fabricated handles are rejected. It performs no persistence or
runtime startup. Household selection and one-household automatic selection are
implemented in 4.8H. Explicit discovery/registration/context orchestration and
active context state are implemented in 4.8I. React/application lifecycle integration, automatic Better Auth
observation, queue/cache/pull/mutation runtime, retries, timers, WebSockets, and
cross-tab behavior remain deferred.

4.8H adds only `apps/web/src/sync/household-selection.ts` for factory-created,
in-memory household selection composed with 4.8G. It validates and freezes ordered
candidates, handles zero/one/multiple eligibility, preserves eligible same-account
preference after fresh discovery, and requires explicit choice after selection
loss. Access invalidation discards candidates. Opaque operation handles require
current session and exact household/Core user/controller/selection revision;
switches and session abort invalidate prior work. Account changes/logout clear
preference; skipped generations conservatively discard it. No resolved context,
adapter invocation, persistence, React integration, or runtime startup is added.
4.8I now performs explicit selection -> account-owned registration -> context.

4.8I adds only `apps/web/src/sync/context-coordinator.ts` in production, with
`createSyncContextCoordinator(dependencies)` injecting the three existing adapters
and owning fresh 4.8G/4.8H guards. Explicit `refresh`, `selectHousehold`,
`clearSelection`, `invalidate`, and `getSnapshot` methods expose detached frozen
observations: unauthenticated, discovering, no-households, selection-required,
selection-lost, access-invalidated, registering, resolving, ready, or failed.
Only ready carries context; failures preserve stage/code/message/status/requestId.
Refresh clears context, checks the session before discovery adoption, and prepares
only selected households. Selection during discovery is rejected; selecting a
current candidate explicitly prepares fresh context. Registration remains
account-owned and serialized until each preceding promise settles, even after
cancellation. Exact attempt/session/household checks reject stale success/failure;
Core-user equality is checked before context adoption. Replacement state is
published before abort, with guard mutations serialized against synchronous reentry.
Authentication failure clears account state; context access denial discards
eligibility; Core-user mismatch fails closed and requires fresh discovery.
Other failures remain distinct, without inferred logout/access loss or identity rotation.
Import/factory creation is effect-free. No React, lifecycle startup, persistence,
queue/cache/pull/mutation/cursor runtime, timers, WebSockets, or cross-tab work is added.
51 temporary focused coordinator scenarios, existing household-guard assertions,
web typecheck/build, whitespace checks, and full diff review passed. Base is `62ec3ed`. Live browser/lifecycle integration
and the remaining synchronization runtime/reconciliation work remain deferred.


4.8J adds `apps/web/src/sync/submit-mutation.ts` as a single explicit protocol boundary
for the currently supported Core household update mutation. It validates and captures the
request before dispatch, preserves caller-supplied mutation identity and decimal-string
BIGINT values, performs exactly one same-origin POST, validates applied/conflict/rejected/
received and replayed server results including authoritative household state, preserves
valid Homi errors, and treats post-dispatch transport/cancellation as outcome-unknown.
It performs no retry, queue/storage reconciliation, recovery, cursor/pull work, lifecycle
wiring, or runtime startup. Focused validation, web typecheck/build, and diff checks passed.

4.8K upgrades browser sync persistence so household-local state is owned by both
the authenticated account and household. Cursors use account+household metadata keys; cache
and queued mutation rows carry `authSubject`; queue reads, mutation transitions, completion,
and interrupted-send recovery enforce that owner. Because version-1 cache/mutation/cursor
state had no trustworthy account owner, the Dexie v2 upgrade discards only that unowned sync
state while preserving installation-global `clientInstanceId` and account-owned client IDs.
No delivery/retry/pull/runtime behavior is added. Migration and same-household/two-account
isolation assertions passed along with web typecheck/build and diff validation.

4.8L adds bounded sequential delivery of the account-owned household queue through the
validated mutation submission adapter. Dexie v3 gives each account/household queue a durable
monotonic `queueOrder`, including deterministic migration of existing v2 rows. Applied,
conflict, and rejected server outcomes are recorded durably; applied rows are retained until
later pull/cache reconciliation safely reaches their change sequence. Received, transport,
auth/context, and cancellation-unknown outcomes keep the same mutation ID queued for replay.
The batch stops at a conflict/rejection/deferred result, preserves later work, and adds no
automatic retries, pull/cache application, cursor advancement, or app lifecycle runtime.

4.8M adds explicit browser adapters for pulling the ordered server change feed and
acknowledging the server cursor. They preserve decimal-string BIGINT values, validate exact
identity/order/envelope invariants, retain Homi errors, and expose detached immutable results.
They deliberately perform no local cache writes or cursor advancement themselves; durable
apply-before-ack reconciliation remains the next dependency.

4.8N adds the missing authoritative Core household snapshot fetch required to turn
change-log metadata into cacheable state. It validates exact household identity and revision
without mutating storage. Durable pull/apply/ack composition remains deferred.

4.8O adds generic one-page reconciliation: exact module/entity handlers materialize each
ordered change, Dexie atomically applies cache actions plus the local cursor and retires
applied mutation receipts only after their change sequence is reached, then the server cursor
is acknowledged. The first handler covers Core household settings without embedding that
business shape in the generic reconciler. Ack failure cannot roll back already-safe local
state; a later empty-page run can acknowledge it. Background/runtime scheduling remains
deferred.

4.8P composes one explicit foreground synchronization cycle from the ready context: recover
interrupted sends, deliver one durable mutation batch, then reconcile bounded change pages.
Cycles serialize within the coordinator and reject stale context at asynchronous boundaries.
There is still no automatic lifecycle startup, retry scheduler, timer, WebSocket, or cross-tab
coordination.

4.8Q connects the validated synchronization stack to the React browser application. The
mobile-first shell now supports Better Auth sign-in/sign-out, household discovery/selection,
ready-context establishment, initial/explicit foreground sync, and online/visibility refresh.
The lifecycle remains event-driven and bounded; no background polling or hidden retry loop is
introduced. Concrete fake-browser integration validation proves the full context-to-sync path.

4.8R makes the browser shell installable/offline-capable and persists only the last
server-validated active account/household context for offline reopening. The service worker
pre-caches the production shell/assets while leaving API traffic network-owned. Logout or a
positively observed unauthenticated session clears the active offline pointer. Headless Chrome
proved shell recovery with the origin stopped; fake-IndexedDB tests proved offline context
hydration/clearing. With the previously validated queue/delivery/pull/reconciliation lifecycle,
Master Step 4 is complete.

Master Step 4 synchronization is complete. The corrected next gate is Master Step 5: Homi application shell, shared design system, and module platform. Existing Calendar code is frozen as reference work until that gate passes.

Do not invent or renumber later roadmap steps without deriving them from locked product requirements and recording the explicit decision.
