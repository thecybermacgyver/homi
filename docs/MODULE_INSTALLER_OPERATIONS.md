# Homi Module Installer Operations

This document describes the operator-facing module installation and recovery workflow introduced in Master Step 5.4.

The normal household module-management UI is a later platform layer. These commands are the trusted maintenance path underneath that UI.

## Managed module artifacts

Installed module packages are stored in the persistent Docker volume:

- volume: `homi_modules_data`
- container path: `/app/apps/core/.homi-modules`

The maintenance installer mounts that volume read/write.

The running Homi Core mounts the same volume read-only.

The path deliberately lives under `apps/core` so installed server entrypoints can resolve Homi's public runtime module SDK through the Core package dependency graph without bundling private Core code into the module.

## Prepared packages

The installer accepts an already-built module package directory.

A prepared package must include:

- `homi.module.json`
- `package.json`
- every declared server/web entrypoint
- module migrations when declared
- localization resources when declared

The installer does not run `npm`, `pnpm`, package lifecycle scripts, or arbitrary build commands.

Build and author validation happen before installation.

## Live-operation prerequisite

Before a live schema-changing installation/update, follow the Homi deployment protocol:

1. verify the intended package/version/digest
2. back up the live database
3. preserve a source/deployment rollback point
4. validate Compose/configuration
5. run installation through the maintenance service
6. verify module registry, migrations, application health, and unrelated services

Do not experiment against the live Homi database.

## Install or update

Mount the prepared package read-only into the maintenance container:

```sh
docker compose --profile maintenance run --rm \
  -v /absolute/path/to/prepared-module:/module-package:ro \
  module-admin install /module-package
```

The installer:

1. validates package structure and manifest/API compatibility
2. rejects symlinks and unsafe/missing declared paths
3. computes an immutable SHA-256 package digest
4. validates module migration ownership/safety rules
5. copies the package into the managed artifact store
6. serializes installation for the module key with a PostgreSQL advisory lock
7. validates publisher ownership and semantic-version progression
8. records a pending module/version/update run
9. applies unapplied module migrations in one transaction
10. verifies previously applied migration checksums
11. creates/maintains the module migration ledger
12. applies Homi-owned runtime schema grants
13. promotes the candidate version only after successful migration completion
14. retires the previous applied version
15. preserves a pre-existing global disabled state

Installing a module does not enable it for any household.

Household enable/disable belongs to Master Step 5.5.

## Idempotent reinstall

Installing the same module version with the same package digest returns `already-installed` and does not rerun migrations.

The same version with a different package digest is rejected. Published version contents are immutable.

## Update failure

A failed candidate:

- rolls back its migration transaction
- is marked `failed`
- is retired from active consideration
- records error details in `core.update_runs`
- leaves the previous applied version current
- preserves a previous global disabled state

The failed package artifact and registry/version history are retained for diagnosis.

## Recover a failed update

Recovery does not require access to the module artifact volume:

```sh
docker compose --profile maintenance run --rm \
  module-admin recover <module-key> <failed-target-version>
```

Recovery:

- marks the failed target version `rolled_back`
- keeps it retired
- restores/unretires the prior applied version
- records the update run as `rolled_back`
- preserves global disabled state

Recovery does not attempt destructive reverse SQL migrations.

The migration transaction is rolled back at failure time instead.

## Migration ownership

Homi creates:

- `mod_<module_key>`
- the module's `schema_migrations` ledger
- runtime grants for `homi_app`

Module migration files do not manage schema creation, roles, grants, ownership, transaction state, or search path.

They may modify only objects inside the module-owned schema.

The installer rejects migrations that reference:

- `core`
- `auth`
- `jobs`
- `public`
- another `mod_*` schema

It also rejects installer-owned or unsafe SQL classes defined by the 5.4 migration contract.

## Migration history

Each applied migration records:

- migration ID
- SHA-256 checksum
- module version that first applied it
- applied timestamp

A newer package must still contain every previously applied migration with the exact same checksum.

Changing or removing historical migration files causes the candidate installation to fail before new module migrations are committed.

## Runtime activation

Master Step 5.4 establishes the artifact store and authoritative installed/applied version state.

Generic runtime discovery and dynamic server/web activation are Master Step 5.6 responsibilities.

Until that host is complete, the installer being successful does not by itself mean a newly installed module is visible in household navigation.
