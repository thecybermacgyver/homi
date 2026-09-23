#!/bin/sh
set -eu

: "${HOMI_MIGRATOR_DB_PASSWORD:?HOMI_MIGRATOR_DB_PASSWORD is required}"
: "${HOMI_APP_DB_PASSWORD:?HOMI_APP_DB_PASSWORD is required}"
: "${HOMI_JOBS_DB_PASSWORD:?HOMI_JOBS_DB_PASSWORD is required}"
: "${HOMI_BACKUP_DB_PASSWORD:?HOMI_BACKUP_DB_PASSWORD is required}"

psql \
  --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=migrator_password="$HOMI_MIGRATOR_DB_PASSWORD" \
  --set=app_password="$HOMI_APP_DB_PASSWORD" \
  --set=jobs_password="$HOMI_JOBS_DB_PASSWORD" \
  --set=backup_password="$HOMI_BACKUP_DB_PASSWORD" <<'EOSQL'

CREATE ROLE homi_owner NOLOGIN;
CREATE ROLE homi_migrator LOGIN PASSWORD :'migrator_password';
CREATE ROLE homi_app LOGIN PASSWORD :'app_password';
CREATE ROLE homi_jobs LOGIN PASSWORD :'jobs_password';
CREATE ROLE homi_backup LOGIN PASSWORD :'backup_password';
GRANT pg_read_all_data TO homi_backup;

ALTER DATABASE homi OWNER TO homi_owner;

GRANT homi_owner TO homi_migrator WITH INHERIT FALSE, SET TRUE;

CREATE SCHEMA core AUTHORIZATION homi_owner;
CREATE SCHEMA auth AUTHORIZATION homi_owner;
CREATE SCHEMA jobs AUTHORIZATION homi_jobs;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE homi TO homi_migrator, homi_app, homi_jobs, homi_backup;

GRANT USAGE ON SCHEMA core, auth TO homi_app;

ALTER DEFAULT PRIVILEGES FOR ROLE homi_owner IN SCHEMA core
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO homi_app;

ALTER DEFAULT PRIVILEGES FOR ROLE homi_owner IN SCHEMA auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO homi_app;

ALTER DEFAULT PRIVILEGES FOR ROLE homi_owner IN SCHEMA core
  GRANT USAGE, SELECT ON SEQUENCES TO homi_app;

ALTER DEFAULT PRIVILEGES FOR ROLE homi_owner IN SCHEMA auth
  GRANT USAGE, SELECT ON SEQUENCES TO homi_app;

EOSQL
