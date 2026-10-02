# Building a new Homi module: the workflow

This is the path from an idea to a published, verified module. It records what first-party modules (Calendar, Chequebook, Shopping List) went through, so the next module starts from the same place. The contracts themselves are in [Module authoring](MODULE_AUTHORING.md); this document is the order of work and the checks that gate each step.

A module uses only the public SDK, manifest, shared UI, installer, runtime host, sync/offline, lifecycle, search, action and broker contracts. It never needs a Core or web-shell edit. If a module seems to need one, the public contract is defective: fix the contract in Core as its own change, validate it, and rerun the other modules' acceptance, rather than adding a module-specific path.

## 1. Design before code

Write down and agree, before building:

- **Purpose and users:** what household problem it solves, and whether its data is shared by the whole household or private per member.
- **Entities and operations:** each synchronized entity type and its create, update and delete operations. Everything must work offline and be idempotent and conflict-safe; server state is authoritative.
- **Pages:** the module's navigation entries, and what each shows.
- **Family Board cards:** each card, its declared sizes, and any member-selectable styles.
- **Setup and settings:** what a household must configure first, and what each member can choose.
- **Search:** what a result is, which fields match, and what choosing it opens (see [Search](MODULE_AUTHORING.md#search)).
- **Permissions and brokers:** the capabilities it requests, and any other module it talks to through the broker.
- **Privacy:** what other members can see.

Decisions that are the owner's to make (what the module is for, what it looks like) are agreed first; engineering choices follow the existing patterns.

## 2. Scaffold

Copy `templates/homi-module-template`, then set the module key, name, publisher, manifest, module-owned PostgreSQL schema (`mod_<key>`), migrations and locale file. Homi application tables never go in `public`. Keep the module independent: its own package, no imports from Core.

## 3. Implement

Follow the template and [Module authoring](MODULE_AUTHORING.md). Rules learned from the first modules:

- **Offline first.** Read from the local working cache (`listWorkingEntities`), which includes changes still queued. A record created offline has base revision `0` until it is delivered, so any parser for cached records must accept revision `0` or the new record disappears.
- **Live updates.** Reload when the host hands the page new `actions` (a change was synchronized); online, refetch authoritative server state after activity settles so totals and lists follow other devices.
- **Never depend on `actions` identity in the effect that registers contextual actions.** Registering updates the host, which hands back new `actions`, so the effect re-registers in a render loop.
- **Forms** open in the shared `BottomSheet` or `Dialog`, never in a module-made overlay, so focus handling, Tab trapping and Escape work. A form opened before its data has loaded must adopt defaults once the data arrives.
- **Search** is Core's. Provide a search provider and consume the open intent; do not build a search box.
- **Design system.** Use shared components and tokens only; every text colour must meet 4.5:1 contrast. Give icon-only controls accessible names.
- **Idempotent mutations.** A replayed mutation must be a safe no-op, and a stale revision must surface as a reviewable conflict, never silent data loss.

## 4. Validate locally

From the repository root, `pnpm -r typecheck` and `pnpm --filter @homi/web test`. In the module, `pnpm build` and `pnpm contract:validate` (manifest, isolation and provider-security checks). Database-backed validators need a fresh migrated database each (see the [development protocol](DEVELOPMENT_PROTOCOL.md)).

## 5. Isolated acceptance

Never test against a real household. Stand up a separate Homi stack: its own compose project name, volumes and loopback ports, images identical to production, the bootstrap owner plus one second member, and invented data only. Run browser acceptance in the style of `packages/calendar/qa/acceptance.mjs` and `packages/chequebook/qa/acceptance.mjs`, covering at least:

1. Two devices of one member and a distinct member see the same data.
2. Online changes propagate automatically in both directions.
3. A full browser restart while offline still loads the module and its data.
4. Offline create, edit and delete survive another restart and stay queued.
5. Reconnect delivers every queued change without self-conflicts.
6. A stale offline edit is surfaced for review and the shared version stays on screen.
7. Totals or summaries match the server on every device.
8. Search finds the module's items and choosing one opens it; Add works.
9. No horizontal overflow at 390, 768 and 1440 px, and no page errors.

Then run the shared checks: `apps/web/qa/accessibility-acceptance.mjs` (add the module's screens), `apps/web/qa/universal-search-acceptance.mjs`, and `apps/web/qa/pwa-update-acceptance.mjs` for upgrades. The package that ships must be byte-identical to the package that passed: if the code changes after testing, bump the version and test again.

## 6. Release

Bump the version in the manifest, `package.json` and the module's version constant. Build, then package only runtime files (`dist`, `homi.module.json`, `locales`, `migrations`, `package.json`). Compute the package digest with Core's package inspector; that digest is what the signed directory pins. Take a verified backup before installing on a real server, and install through the managed installer, which applies migrations transactionally and recovers on failure. Record the change in `CHANGELOG.md`, `docs/RELEASE_NOTES.md` and the README module list.

## 7. Publish

- Commit to the public repository with no private information: no names, emails, domains, addresses, server paths, real-data screenshots or credentials. Screenshots come only from fixture stacks with invented data.
- Tag `<module>-v<version>` and create a GitHub release carrying the `.homi-module` package.
- Update the module's entry in the signed directory (version, asset URL, digest, source URL, timestamps) and publish a new immutable `module-directory-*` release plus the stable endpoint. Mark it `verified` only with the acceptance evidence above and the owner's explicit approval of its final look and feel.
- Run `node scripts/audit-module-directory.mjs <public-key.pem>`; every signature must verify and every package must match its pinned digest.

## Definition of done

The module passes the acceptance above with the shipped package, the accessibility pass has zero violations, documentation and changelog are updated, the release is verified in the directory, a real device has been used by the owner, and no private information is anywhere in the repository history.
