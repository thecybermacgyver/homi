# Homi trusted module directory

Homi discovers publishable modules through one signed JSON catalogue hosted as a GitHub release asset. Homi installations use the permanent `module-directory` release URL; publication refreshes that release's signed catalogue assets only after retaining the same assets in a new immutable, versioned directory release for audit and recovery. Core does not scrape repositories, trust mutable branch files, or execute package-manager lifecycle scripts.

## Trust boundary

The outer document contains only:

- `payload`: the exact UTF-8 JSON string that was signed.
- `signature.algorithm`: `ed25519`.
- `signature.keyId`: an operator-trusted key identifier.
- `signature.value`: the base64 Ed25519 signature of `payload`.

Core verifies the signature before parsing or returning any catalogue entry. Trusted keys are configured locally; a catalogue cannot add its own trusted key.

Each entry pins a module key, publisher, compatible module API version, semantic version, permissions, HTTPS source URL, immutable GitHub release asset URL, and `sha256:` package digest. Revoked entries remain visible as revoked but must not be offered for installation.

## Core configuration

Configure the directory trust boundary:

- `HOMI_MODULE_DIRECTORY_URL`: HTTPS URL on `github.com` or `objects.githubusercontent.com`.
- `HOMI_MODULE_DIRECTORY_TRUSTED_KEYS`: JSON object mapping key IDs to PEM Ed25519 public keys.
- `HOMI_GITHUB_TOKEN`: optional GitHub token used server-side for private release assets. It is never sent to the browser.

Configure the isolated installer bridge:

- `HOMI_MODULE_MANAGER_URL`: internal Compose URL for the module manager.
- `HOMI_MODULE_MANAGER_SECRET`: high-entropy bearer secret shared only by Core and the manager.
- `HOMI_BACKUP_DATABASE_URL`: manager-only connection for the dedicated read-only `homi_backup` role, which inherits PostgreSQL `pg_read_all_data`. Installation still uses the separate migrator connection.

Authenticated clients read the verified catalogue from `GET /api/v1/core/module-directory`. When the directory is not configured, Core returns `MODULE_DIRECTORY_NOT_CONFIGURED` with HTTP 503. A signature, key, schema, compatibility, URL, or digest failure rejects the complete catalogue; Core never serves a partially trusted result.

The installed-module catalogue remains separate at `GET /api/v1/core/modules`. Directory discovery itself does not mutate state. A household administrator can request installation with `POST /api/v1/core/module-directory/:moduleKey/install`; the browser supplies only the module key, and Core re-reads the verified directory entry before handing it to the internal manager. Installation and household enablement remain separate actions.

A household administrator can uninstall an installed module with `DELETE /api/v1/core/modules/:moduleKey`, but the module must first be disabled everywhere it is in use. The internal manager creates the same database-and-artifact recovery set used before installation, marks the global runtime unavailable, removes the active runtime artifact, and preserves the module-owned schema, records, configuration, household lifecycle history, and member presentation preferences. The module returns to the signed directory as Available. Reinstalling the same immutable release reactivates the preserved registry and data without replaying applied migrations.

## Publication workflow

1. Build the module outside Core from the public SDK/template.
2. Run manifest, isolation, typecheck, build, migration, and clean-install validation.
3. Package only prepared runtime files; no install scripts are run by Homi.
4. Publish the immutable package as a GitHub release asset.
5. Record the asset SHA-256, requested permissions, module API version, publisher, source, and release timestamp.
6. Update the catalogue payload, sign its exact bytes with the offline directory key, and publish the envelope as a new immutable, versioned directory release.
7. Replace the assets on the permanent `module-directory` release with the exact validated assets from that immutable release. Homi installations keep using `https://github.com/thecybermacgyver/homi/releases/download/module-directory/directory.json`; no installation configuration or Core restart is required when later modules are published.
8. Keep every versioned catalogue and module release available for audit and recovery.

Installation still uses the managed installer. The manager authenticates Core, downloads the immutable GitHub asset, enforces the archive size limit and safe extraction contract, independently recomputes the package digest, validates the signed entry against the manifest, preserves publisher ownership, applies migrations transactionally, and retains the prior applied artifact/version on failure. Core exits only after a successful installation so Docker restarts it and loads the newly installed runtime.

## Recovery semantics

Immediately before each install attempt, the manager creates a timestamped recovery set containing a PostgreSQL custom-format dump, a recursive copy of managed module artifacts, and a manifest. A module update then changes its schema and registry promotion inside one PostgreSQL transaction. If any migration or promotion step fails, PostgreSQL rolls back all candidate data/schema changes and Homi restores the prior module state. The previous immutable artifact remains present and active. Recovery then marks the failed candidate `rolled_back`; it does not perform a whole-database restore that could erase unrelated family changes made concurrently.

Operators should still create the documented database/source/module-volume backup before a production deployment. That backup is disaster recovery, while transactional rollback is the automatic per-module safety mechanism.
