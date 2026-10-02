# Homi public-release checklist

This checklist tracks the gates for Homi's stable 1.0 release. The owner approved public visibility, and the repository is published as a pre-1.0 release; unchecked items remain open before 1.0.

## Repository and legal

- [x] AGPL-3.0 licence committed.
- [x] Dashboard and phone design-direction images included and identified as concepts.
- [x] README describes architecture, supported modules, installation, and current pre-1.0 status.
- [x] Contribution and private security-reporting policies committed.
- [x] Real `.env` files, secrets, private keys, backups, dumps, and production data excluded.
- [x] Full Git history scan finds no common private-key, GitHub-token, or cloud-access-key patterns; only the placeholder `.env.example` path exists in history.
- [x] Production dependency licences reviewed: Apache-2.0, BSD-3-Clause, ISC, and MIT.

## Build and security

- [x] Workspace typecheck and build pass.
- [x] High/critical production dependency audit passes.
- [x] Calendar XML parser upgraded from the vulnerable 5.3.0 release.
- [x] Compose configuration validates with documented environment variables.
- [x] GitHub validation workflow covers install, typecheck, build, audit, manifests, directory, and lifecycle routes.
- [x] Application security review passes: authentication, authorization, upload/import parsing, SSRF, XSS, CSRF, rate limiting, sensitive logging, and built-response security headers. Evidence is recorded in `docs/SECURITY_REVIEW.md`.
- [ ] Accessibility review passes keyboard, focus, labels, contrast, reduced motion, and phone/tablet/desktop layouts. Shared-component fixes and the remaining authenticated manual pass are recorded in `docs/ACCESSIBILITY_REVIEW.md`.

## Installation and recovery

- [x] Clean-machine deployment passes from a verified tracked-files-only archive at commit `eeb7839` on a fresh Docker engine, following the README exactly: core migration, bootstrap (repeat refused), Calendar 0.6.10 and Chequebook 0.1.14 installation, all four runtime services healthy, runtime bridges and module assets HTTP 200, manifest served as `application/manifest+json`, sign-in, module enablement, card preferences, members list, and password change (2026-09-29). First passed at commit `f15625b` on 2026-09-23.
- [x] First-account/bootstrap procedure is documented and tested (single owner/household/admin creation, successful login, and fail-closed repeat attempt).
- [x] Backup creation and documented restoration are tested on the release candidate (database restore matched critical records; all 109 managed-module files matched SHA-256).
- [x] Module install, enable, disable, uninstall, reinstall, failed update, and rollback pass end to end in the isolated release-candidate deployment.
- [x] Preserved module data is verified after uninstall/reinstall and after failed-update rollback.

## Product acceptance

- [x] Calendar multi-device acceptance passes with automatic synchronization (isolated two-device plus second-member browser acceptance, `packages/calendar/qa`, Calendar 0.6.16, 2026-10-01; owner real-device confirmation pending).
- [x] Chequebook multi-device acceptance passes with automatic synchronization (owner-confirmed on phone and desktop, 2026-09-30). Re-run and passed in the isolated browser acceptance at Chequebook 0.1.21 (2026-10-01).
- [x] Calendar ↔ Chequebook recurring-entry changes reconcile without duplicate or stale events (owner-confirmed, 2026-09-30).
- [x] Offline create/edit/delete and reconnect pass on phone and desktop (Calendar 0.6.16 and Chequebook 0.1.21: isolated three-profile browser acceptance `packages/*/qa/acceptance.mjs`, 2026-10-01, plus owner-confirmed on real phone and desktop, 2026-10-01).
- [ ] PWA install/update behavior passes without manual cache clearing. The isolated acceptance (`apps/web/qa/pwa-update-acceptance.mjs`, 2026-10-01) passes: valid manifest and no Chrome installability errors, module upgrades (Calendar 0.6.14 to 0.6.16, Chequebook 0.1.15 to 0.1.21) picked up by the open app on reconnect with no reload or cache clearing, a device offline during the upgrade keeping its queued change, and a new shell (service-worker cache v19 to v20) installing and reloading itself on the next open, all while signed in with data intact and fully offline starts afterwards; the owner's real-device confirmation remains.
- [ ] Search and Add controls pass in Core and the first-party modules. Add is owner-confirmed. Search was only a per-view filter (owner-reported 2026-10-02); it is now one Core-owned universal Search across Calendar, Chequebook and Shopping List, and its isolated acceptance (`apps/web/qa/universal-search-acceptance.mjs`, 2026-10-02) passes on the Dashboard and inside modules, offline, and at phone/tablet/desktop widths; the owner's real-device confirmation remains.

## Publication

- [ ] Public module-directory URLs and release assets are immutable and anonymously readable.
- [x] Release notes, known limitations, upgrade instructions, and recovery instructions are complete in `docs/RELEASE_NOTES.md`, `README.md`, `docs/MODULE_INSTALLER_OPERATIONS.md`, and `docs/BACKUP_RECOVERY.md`.
- [ ] Release candidate is tagged without changing published bytes afterward.
- [x] Owner explicitly approves changing GitHub visibility from private to public.
