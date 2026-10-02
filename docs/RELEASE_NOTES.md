# Homi pre-1.0 release notes

Status: published pre-1.0 release. Homi runs in everyday household use but has not declared a stable 1.0; public module APIs are versioned, and any breaking change before 1.0 will be documented.

## Included

- Homi Core with accounts, households, permissions, audited changes, offline-first synchronization, PWA delivery, backup/recovery, and the managed module platform.
- Calendar 0.6.19, Chequebook 0.1.25, and Shopping List 0.3.2, whose Dashboard cards declare sizes and adapt to the size each member chooses: today's events with times, the coming week by day, a mini month with event dots, bold balance and spending figures, and the shopping list or counts by store.
- Public `@homi/module-sdk`, `@homi/ui`, and the starter module template.
- Signed module-directory verification and administrator-only install, update, disable, uninstall, reinstall, and rollback.
- Per-household module enablement, and per-member Dashboard visibility, order, and card style (for example Shopping's list or counts by store), chosen on the Modules screen.
- A Family Board grid (8 columns wide, 4 on phones) that each member arranges with "Arrange cards": drag to move, drag a corner to resize, or use the arrow keys. Phone and wide-screen layouts are saved separately, and cards stay exactly where they are left. Modules may declare card sizes.
- Self-service password change, and administrator password reset that requires the member to choose a new password at their next sign-in.
- Offline queue guarantees: an edit made right after creating an item continues from its delivered revision; conflicts and rejections stay available for review until dismissed; writes that are still retrying are never discarded.
- Calendar ↔ Chequebook recurring-entry integration through the public broker contract.
- Calendar 0.6.14: on phones and narrow windows, month cells show up to three coloured event dots and a "+N" count instead of looking empty. Wider windows still list event titles.
- Universal Search: one Core-owned Search control, reachable from the Dashboard and every module page, searches Calendar events, Chequebook transactions and Shopping list items in every month and date range at once, including offline, grouped by module; choosing a result opens that item in its module. Modules supply a search provider through the public SDK (Calendar 0.6.18, Chequebook 0.1.25, Shopping List 0.3.2). Search previously only filtered the page you were looking at.
- Chequebook 0.1.22: a transaction form opened before the household's accounts have loaded now adopts the default account instead of being unable to save. 0.1.21 changes: changes made on another device, and the balances they affect, now appear automatically instead of only after reopening Chequebook; a transaction created offline now appears immediately; and a continuous re-rendering loop while Chequebook was open is fixed. An isolated multi-device acceptance suite (`packages/chequebook/qa`) covers these.
- Calendar 0.6.16: events created while offline now appear immediately instead of vanishing until they sync, and an isolated multi-device acceptance suite (`packages/calendar/qa`) covers sync between devices and members, offline create/edit/delete across restarts, reconnect, and stale-edit conflicts.

## Installation and upgrade

New installations follow [First deployment](../README.md#first-deployment). Operators must set independent secrets, a public HTTPS origin, and trusted module-directory keys before enabling directory installation.

Before any upgrade, create and verify the database and managed-module backups described in [Backup and disaster recovery](BACKUP_RECOVERY.md). Update source, rebuild the images, run Core migrations, then install module updates through Homi's managed installer. Do not replace the managed-module volume manually.

Recovery from a failed module update follows [Module installer operations](MODULE_INSTALLER_OPERATIONS.md#recover-a-failed-update). Whole-installation restoration follows [Backup and disaster recovery](BACKUP_RECOVERY.md#restore).

## Known limitations

- Homi is pre-1.0. Breaking changes may still occur before 1.0 and will be documented.
- There is no in-app way to invite or add household members yet. Bootstrap creates the first account and household; further members currently have to be added by an operator.
- Calendar supports Homi calendars and a restricted Apple CalDAV provider. It is not a general-purpose arbitrary CalDAV proxy.
- The signed public module directory offers Calendar 0.6.19, Chequebook 0.1.25, and Shopping List 0.3.2 as verified. Install them from the directory's Modules screen, or install Calendar and Chequebook from the Core image as described in First deployment.
- TLS termination, certificates, DNS, HSTS, host firewalling, and off-host backup retention remain operator responsibilities.
- Module installation and lifecycle changes require a household administrator; ordinary members control only their own Dashboard cards, card styles, and layouts.

## Validation status

On 2026-09-29 a clean installation of the published code (commit `eeb7839`) passed on a fresh Docker engine by following the README exactly: deployment-archive verification, image build, Core migrations, first-account bootstrap (and a refused second attempt), Calendar 0.6.10 and Chequebook 0.1.14 installation, all services healthy, PWA manifest and module runtime files served, sign-in, module enablement, per-member card preferences, the household members list, and password change. Earlier release-candidate evidence covers dependency/security review, backup restoration, and the full module lifecycle including failed-update rollback. Remaining evidence is tracked in [the release checklist](RELEASE_CHECKLIST.md), including authenticated accessibility and multi-device acceptance for Calendar and Chequebook.

## Actual application screens

These are real Homi screens shown with invented sample data.

![Homi Dashboard on a phone](assets/homi-dashboard-phone.jpg)

![Homi Dashboard on desktop](assets/homi-dashboard-desktop.png)

![Homi Chequebook module on desktop](assets/homi-chequebook-desktop.png)

![Homi Calendar module on desktop](assets/homi-calendar-desktop.png)
