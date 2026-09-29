# Shopping rebuild and acceptance gate

## User direction — 2026-09-23

The rejected Shopping 0.1.0 must be withdrawn from public GitHub before rebuilding.
The replacement must be installed and tested on the owner's Homi server before public publication.
This supersedes the earlier instruction not to install Shopping on that server.
Do not publish a replacement package, public source, or catalogue entry until functional
acceptance and the owner's visual review are complete.

## Public withdrawal — verified

- Public main commit: 650ea13 (removes packages/shopping and its lockfile importer).
- Shopping 0.1.0 release and tag deleted.
- Directory 2026.09.23.2 release and tag deleted.
- Stable signed catalogue refreshed from directory 2026.09.23.3.
- Downloaded stable catalogue signature verified; only Calendar and Chequebook remain.
- Historical Git commits were not rewritten.

## Required product behavior

- Module name Shopping; displayed list title Shopping List.
- Pinned dashboard card follows Homi_list_style.jpg: warm cream, rounded card,
  readable dark brown type, simple checkbox rows, and the shell's single star.
- Shared household list updates automatically across clients without manual refresh.
- Automatic item categorization and grouping by store/aisle, with editable overrides.
- Store-specific item assignments and household-person assignments.
- Create, edit, remove, check off, and restore items from appropriate surfaces.
- Dashboard check-off must not accidentally navigate away.
- Phone-first layout, then tablet and desktop; Core owns navigation and Search/Add.
- Offline changes remain visible and durable and reconcile through Core sync.
- Modules use public SDK/UI and preserve module-owned schema boundaries.

## Defects observed in rejected source

- ShoppingPage registers contextual actions in an effect depending on actions;
  Core creates a fresh actions object on every render, and registration sets parent state.
  This creates a render-loop risk requiring an actual browser regression test.
- No item-edit flow is implemented.
- Page cache reload does not respond to subsequent Core sync renders.
- Dashboard checkbox events bubble to the shell's card navigation handler.
- Offline queue writes do not project pending changes into the displayed list;
  listCachedEntities reads authoritative cache, not the mutation queue.
- Fetching historical create/update changes for subsequently deleted items returns 404,
  potentially stopping change-feed reconciliation before the later delete.

## Acceptance before publication

1. Validate manifest, isolation, build/typecheck, and module migrations locally.
2. Test the candidate through the managed installer in an isolated environment.
3. Back up live database and managed artifacts before the server candidate install.
4. Install a new immutable candidate version through the managed maintenance installer.
5. Exercise creation/editing, store/aisle grouping, assignment, check-off/restore,
   cross-client updates, dashboard interactions, offline/reconnect, conflicts,
   household isolation, and existing-module regressions.
6. Verify phone/tablet/desktop layouts and let the owner review the actual server UI.
7. Publish only the accepted version; refresh the existing permanent signed catalogue.

No rebuilt candidate has been installed or accepted as of this withdrawal checkpoint.

## 2026-09-28 — Shopping server test installation

Shopping 0.2.2 is installed and enabled for the sole active home household at
https://homi.example.com. Final appearance approval remains PENDING.
No GitHub commit/push/release/directory publication was performed in this run.
Private main baseline: 423fa487bdfcc6f2f3ded91ecc4ef6b43d93947c; development branch
shopping-rebuild-20260923, HEAD e87fa83, with the reviewed changes uncommitted.

Package digest: sha256:383dbafa77282ea16d061c74475b47582e9ced7c0b3b2a28e7ac449e3433f69c.
The exact isolated-test web image was promoted; service worker is homi-shell-v16.
Shared Core client fixes are in App.tsx, sync/local-db.ts,
sync/deliver-mutations.ts and sync/working-entities.ts. They implement durable
same-entity dependencies, first-send actual revision binding, immutable retries,
dependent failure review, automatic enqueue delivery and unrelated-entry progress.
Shopping uses only public SDK/cache/outbox APIs; no private sync engine remains.

All issue #2 acceptance categories passed in the isolated server stack, including
full browser restarts offline, complete offline edit chains, automatic reconnect,
two devices plus a distinct authorized household user, targeted-recipient privacy,
replay/conflict behavior, exact adapter/handler contracts, full workspace build,
typecheck, offline assets and 390/768/1440 layout checks. Evidence and reproducible
scripts are under packages/shopping/qa. Core web regression suite: 12 passed.
Calendar/Chequebook contracts and Core module mutation routing also pass.

Production verification: Shopping enabled at household revision 1; runtime also
contains unchanged Calendar 0.6.10 and Chequebook 0.1.13. Core/Web/manager healthy,
zero restarts; public ready endpoint passes. Public Shopping asset and shell HTML
match the validated local artifacts byte for byte. No test records/accounts were
added to the production household.

Verified pre-install recovery set:
~/Homi-backups/shopping-20260928-145637
Off-server verified copy:
~/Homi-backups/shopping-20260928-145637
Contains full database dump, managed-module archive, deployed-source archive,
image identities and checksums. Calendar/Chequebook data fingerprints before and
after installation are identical. Prior Web image tag:
homi-web:before-shopping-20260928.

Next: the owner tests the installed Shopping module and approves or requests changes
to its appearance. Publication remains blocked pending that explicit approval.

## Shopping publication approved and completed — 2026-09-28 (Toronto)

the owner confirmed all works and explicitly approved public release and inclusion in
the Modules list. Public source checkpoint: 660f36a1a6d08d209aa18fc203ddb0f8da4b3d7b.
Release: https://github.com/thecybermacgyver/homi/releases/tag/shopping-v0.2.2
Signed catalogue: module-directory-2026.09.29.1, copied byte-for-byte to the stable
module-directory endpoint. Shopping 0.2.2 is verified against
homi-module-offline-multiuser-1.0.0; the exact running artifact was recovered and
packaged without rebuilding or changing its contents.
Package digest: sha256:383dbafa77282ea16d061c74475b47582e9ced7c0b3b2a28e7ac449e3433f69c.
Archive digest: sha256:a532df6b4fe7dd983c3a3f0055fd0a31dabbeee7ff1173d1644ee0f9bdc963c4.

The catalogue uses schema 2. Historical Calendar 0.6.9 and Chequebook 0.1.12
assets remain in the catalogue as unverified (current acceptance evidence was
not available); installed Calendar 0.6.10 and Chequebook 0.1.13 were not changed.
The full public source build/typecheck, 12 Core web tests, Shopping contract and
offline-asset validation passed again before publishing.

## 2026-09-29 — Family Board card styles and Shopping 0.3.0 store counts

Branch `shopping-store-counts`. the owner directed that the per-member list/count
choice live on the Modules page beside each card's Show/Hide and ordering, for
every module. A first candidate that kept the choice in a Shopping-owned
preference table and personal settings screen was withdrawn before release.

Core platform change (generic, no module-specific code): a Family Board
contribution may declare 2–6 `styles`, the first being the default. Core stores
each member's choice in `core.household_member_module_preferences.card_style`
(core migration 0009, nullable, identifier-checked), synchronises it through the
existing recipient-scoped member preference path, shows the choice in the card's
"My Homi cards" row, and passes `props.presentation.cardStyle` to the card.
Undeclared styles are rejected; a style a module update drops falls back to the
new default; preferences cached before the upgrade remain readable offline.
Service worker advanced to homi-shell-v17.

Shopping 0.3.0 declares List / Counts by store and renders unchecked item counts
per store ("All stores", then each store, one per entry, "Any store" last). It has
no new migration, entity or settings surface.

Validation: workspace build/typecheck; SDK, Shopping, Calendar, Chequebook and
template contracts; 16 web tests (4 new for card styles); offline asset check;
Core route/archive/directory/installer/sync-route validators; and
`validate-member-module-preferences-57` on a fresh PostgreSQL fixture including
card-style privacy, validation, replay and fallback. Six other database
validators (household-module-service, independent-module-57, module-runtime-56,
module-runtime-assets-56, calendar-conformance-60, chequebook-01) fail
identically on the unchanged production Core image, so they are pre-existing
stale fixtures, not regressions.

Upgrade rehearsal on the home server (`cardstyles-rehearsal`, own project,
network, volumes, loopback ports): started on production's exact image IDs with
Calendar 0.6.10, Chequebook 0.1.13 (from the pre-install backup) and published
Shopping 0.2.2; seeded items and hid one Chequebook card; then moved to candidate
images built from a650e8a under test-only tags, applied migration 0009, and
installed Shopping 0.3.0 (no module migration). All 14 existing card preferences
survived. Browser acceptance passed: default list after upgrade, hidden card
still hidden, Modules page List / Counts by store on Shopping only, correct
counts, automatic propagation to the owner's second device, another member unable
to change the owner's style or set an undeclared one and syncing cleanly, offline
change plus reload, reconnect without conflicts, counts following check-off,
390/768/1440 without overflow, no JavaScript errors. Evidence:
packages/shopping/qa/store-counts-acceptance.{mjs,json}, card-style-modules-390.png,
store-counts-*.png. Production image tags and containers were never changed.

Deployment rehearsal (`deploy-rehearsal`, isolated): started from production's
deployed source 423fa48 and image IDs under rehearsal-only tags, seeded as above,
then ran the production deploy script unchanged apart from directory, tag and
backup-root overrides. It verified the deployment archive
(sha256 b706ab8d…a845e, commit a49b652), the Shopping package digest
(sha256:e68ecb21…f409), took and verified a backup, tagged rollback images,
updated the source, promoted the rehearsed images (core/manager
sha256:ca7b7ecd…, web sha256:4ac2f755…), applied migration 0009, restarted
services, installed Shopping 0.3.0, and confirmed identical module-data and
card-preference fingerprints. Browser acceptance then passed in full. The
rollback script restored the previous images, database (no card_style column,
identical fingerprints), Shopping 0.2.2, source 423fa48 and shell v16.

Pre-existing defects found and fixed (commit c748556): (1) ticking an item
within milliseconds of adding it sent the tick with the add's provisional
revision "0" after the add was already applied locally, so Core's same-entity
dependency rule (pending predecessors only) did not bind it and the server
returned REVISION_CONFLICT; (2) sync recovery deleted every module conflict and
rejection receipt at the start of each sync cycle, and queued writes after three
attempts, so reviewable edits were silently lost. Enqueue now continues from this
device's own applied write (receipt, or cache lineage after reconciliation);
other devices' changes still conflict. Recovery clears only Core's own terminal
receipts. Six unit tests cover both. The production build (web dc5c6dbe)
reproduced (1) during both rehearsal seeds.

Validators (commit 80ac8a3): the six database-backed Core validators that
failed identically on production's image were stale (hand-prepared fixtures,
hard-coded Calendar 0.6.7 / Chequebook 0.1.11, time-bombed reminder dates, a
3-entity Calendar cardinality, and Node imports of browser-bridged web
artifacts). They are now self-contained and current; all seven database
validators pass on fresh migrated PostgreSQL. See DEVELOPMENT_PROTOCOL.md.

Final rehearsal (`deploy-rehearsal-2`): images built from 80ac8a3 (core/manager
sha256:4523fc28…, web sha256:14342b23…), deployment archive commit 5882a54
(sha256 57017112…76d2, no code change from 80ac8a3). Deploy script passed with
identical module-data and card-preference fingerprints; browser acceptance
passed all 14 checks including an immediate add-then-tick reaching the server
and a real two-device conflict staying reviewable across sync cycles and a
reload until "Keep shared version"; rollback restored production's state
exactly. The production bundle is ~/Homi-deploy/cardstyles on the server; the
earlier a49b652 bundle is kept as cardstyles-SUPERSEDED-a49b652.
