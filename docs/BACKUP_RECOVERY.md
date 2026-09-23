# Homi backup and disaster recovery

This procedure protects the authoritative PostgreSQL database and the managed module artifacts. The Git repository or deployed source archive must also be retained at the exact release commit.

Module installation already creates a recovery set and uses transactional rollback. This document covers whole-installation disaster recovery.

## Create a consistent backup

Run from the Homi repository on the server. Choose a backup directory outside the repository and Docker volumes.

```sh
backup_dir="/absolute/backup/path/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"

docker compose stop web core module-manager

docker compose exec -T db \
  pg_dump -U homi_backup -d homi -Fc \
  > "$backup_dir/homi.dump"

docker compose --profile maintenance run --rm \
  --entrypoint sh \
  -v "$backup_dir:/backup" \
  module-admin \
  -c 'tar -C /app/apps/core/.homi-modules -czf /backup/modules.tar.gz .'

git rev-parse HEAD > "$backup_dir/source-commit.txt"
(
  cd "$backup_dir"
  sha256sum homi.dump modules.tar.gz source-commit.txt > SHA256SUMS
)

docker compose up -d module-manager core web
docker compose ps
```

Confirm that both archives are non-empty, every runtime service becomes healthy, and `sha256sum -c SHA256SUMS` passes. Copy the completed directory to storage that is not on the Homi server.

## Restore

Restoration replaces the current Homi database and managed module artifacts. Stop all writers and create a new safety backup before starting. Use source code at the commit recorded in `source-commit.txt`, copy the selected recovery directory onto the server, and verify it first:

```sh
recovery_dir="/absolute/backup/path/backup-to-restore"
cd /path/to/Homi
(
  cd "$recovery_dir"
  sha256sum -c SHA256SUMS
)

docker compose stop web core module-manager
docker compose up -d db

docker compose exec -T db \
  dropdb -U homi_bootstrap --if-exists --force homi
docker compose exec -T db \
  createdb -U homi_bootstrap homi

cat "$recovery_dir/homi.dump" | \
  docker compose exec -T db \
    pg_restore -U homi_bootstrap -d homi --exit-on-error

docker compose --profile maintenance run --rm \
  --entrypoint sh \
  -v "$recovery_dir:/recovery:ro" \
  module-admin \
  -c 'find /app/apps/core/.homi-modules -mindepth 1 -delete &&
      tar -C /app/apps/core/.homi-modules -xzf /recovery/modules.tar.gz'

docker compose up -d module-manager core web
docker compose ps
curl -fsS http://127.0.0.1:3101/health/ready
```

After restoration, verify account login, installed module versions, Calendar and Chequebook data, and synchronization from a client. Do not run migrations or install newer modules until the restored release is confirmed healthy.

## Release-candidate proof

On 2026-09-22 this procedure was rehearsed against an isolated clean release-candidate deployment. The custom-format dump restored into a separate empty database with `--exit-on-error`. Original and restored counts matched for authentication users, Core users, households, installed modules, and both module migration ledgers. Calendar restored as 0.6.6 and Chequebook as 0.1.11. All 109 managed-module files matched SHA-256 after archive extraction, and the original disposable stack returned to healthy state.
