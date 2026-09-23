# Homi public-release checklist

This checklist records the completed release gate for the first public pre-1.0 Homi release. It covers the sanitized public source snapshot only; private Homi installations and their deployment records remain private.

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
- [x] Accessibility review passes keyboard, focus, labels, contrast, reduced motion, and phone/tablet/desktop layouts. Shared-component fixes and the remaining authenticated manual pass are recorded in `docs/ACCESSIBILITY_REVIEW.md`.

## Installation and recovery

- [x] Clean-machine deployment passes from a verified tracked-files-only archive at commit `f15625b`: isolated Compose project, fresh database and module volumes, core migration, Calendar 0.6.7 and Chequebook 0.1.11 package installation, all four runtime services healthy, runtime bridges and module assets HTTP 200, and manifest served as `application/manifest+json` (2026-09-23).
- [x] First-account/bootstrap procedure is documented and tested (single owner/household/admin creation, successful login, and fail-closed repeat attempt).
- [x] Backup creation and documented restoration are tested on the release candidate (database restore matched critical records; all 109 managed-module files matched SHA-256).
- [x] Module install, enable, disable, uninstall, reinstall, failed update, and rollback pass end to end in the isolated release-candidate deployment.
- [x] Preserved module data is verified after uninstall/reinstall and after failed-update rollback.

## Product acceptance

- [x] Calendar multi-device acceptance passes with automatic synchronization.
- [x] Chequebook multi-device acceptance passes with automatic synchronization.
- [x] Calendar ↔ Chequebook recurring-entry changes reconcile without duplicate or stale events.
- [x] Offline create/edit/delete and reconnect pass on phone and desktop.
- [x] PWA install/update behavior passes without manual cache clearing.
- [x] Search and Add controls pass in Core and both first-party modules.

## Publication

- [x] Public module-directory URLs and release assets are immutable and anonymously readable.
- [x] Release notes, known limitations, upgrade instructions, and recovery instructions are complete in `docs/RELEASE_NOTES.md`, `README.md`, `docs/MODULE_INSTALLER_OPERATIONS.md`, and `docs/BACKUP_RECOVERY.md`.
- [x] Release candidate is tagged without changing published bytes afterward.
- [x] Owner explicitly approves changing GitHub visibility from private to public.
