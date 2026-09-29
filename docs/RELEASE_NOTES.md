# Homi pre-1.0 release notes

Status: published pre-1.0 release. Homi runs in everyday household use but has not declared a stable 1.0; public module APIs are versioned, and any breaking change before 1.0 will be documented.

## Included

- Homi Core with accounts, households, permissions, audited changes, offline-first synchronization, PWA delivery, backup/recovery, and the managed module platform.
- Calendar 0.6.10, Chequebook 0.1.14, and Shopping List 0.3.0.
- Public `@homi/module-sdk`, `@homi/ui`, and the starter module template.
- Signed module-directory verification and administrator-only install, update, disable, uninstall, reinstall, and rollback.
- Per-household module enablement, and per-member Dashboard visibility, order, and card style (for example Shopping's list or counts by store), chosen on the Modules screen.
- Self-service password change, and administrator password reset that requires the member to choose a new password at their next sign-in.
- Offline queue guarantees: an edit made right after creating an item continues from its delivered revision; conflicts and rejections stay available for review until dismissed; writes that are still retrying are never discarded.
- Calendar ↔ Chequebook recurring-entry integration through the public broker contract.

## Installation and upgrade

New installations follow [First deployment](../README.md#first-deployment). Operators must set independent secrets, a public HTTPS origin, and trusted module-directory keys before enabling directory installation.

Before any upgrade, create and verify the database and managed-module backups described in [Backup and disaster recovery](BACKUP_RECOVERY.md). Update source, rebuild the images, run Core migrations, then install module updates through Homi's managed installer. Do not replace the managed-module volume manually.

Recovery from a failed module update follows [Module installer operations](MODULE_INSTALLER_OPERATIONS.md#recover-a-failed-update). Whole-installation restoration follows [Backup and disaster recovery](BACKUP_RECOVERY.md#restore).

## Known limitations

- Homi is pre-1.0. Breaking changes may still occur before 1.0 and will be documented.
- There is no in-app way to invite or add household members yet. Bootstrap creates the first account and household; further members currently have to be added by an operator.
- Calendar supports Homi calendars and a restricted Apple CalDAV provider. It is not a general-purpose arbitrary CalDAV proxy.
- The signed public module directory offers Shopping List 0.2.2 as verified. Its Calendar 0.6.9 and Chequebook 0.1.12 entries are older and unverified, so they are hidden unless an administrator enables developer mode. Install current Calendar and Chequebook from the Core image as described in First deployment.
- On a newly signed-in device, Chequebook's Current balance card shows a dash until Chequebook has been opened once on that device.
- TLS termination, certificates, DNS, HSTS, host firewalling, and off-host backup retention remain operator responsibilities.
- Module installation and lifecycle changes require a household administrator; ordinary members control only their own Dashboard cards and card styles.

## Validation status

On 2026-09-29 a clean installation of the published code (commit `eeb7839`) passed on a fresh Docker engine by following the README exactly: deployment-archive verification, image build, Core migrations, first-account bootstrap (and a refused second attempt), Calendar 0.6.10 and Chequebook 0.1.14 installation, all services healthy, PWA manifest and module runtime files served, sign-in, module enablement, per-member card preferences, the household members list, and password change. Earlier release-candidate evidence covers dependency/security review, backup restoration, and the full module lifecycle including failed-update rollback. Remaining evidence is tracked in [the release checklist](RELEASE_CHECKLIST.md), including authenticated accessibility and multi-device acceptance for Calendar and Chequebook.

## Actual application screens

These are real Homi screens shown with invented sample data.

![Homi Dashboard on a phone](assets/homi-dashboard-phone.jpg)

![Homi Dashboard on desktop](assets/homi-dashboard-desktop.png)

![Homi Chequebook module on desktop](assets/homi-chequebook-desktop.png)

![Homi Calendar module on desktop](assets/homi-calendar-desktop.png)
