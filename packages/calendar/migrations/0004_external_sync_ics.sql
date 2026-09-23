CREATE TABLE mod_calendar.external_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  calendar_id uuid NOT NULL
    REFERENCES mod_calendar.calendars(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  account_label text NOT NULL,
  remote_calendar_id text NOT NULL,
  endpoint_url text,
  status text NOT NULL DEFAULT 'connected',
  sync_cursor text,
  last_synced_at timestamptz,
  last_error text,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_mod_calendar_external_provider
    CHECK (provider IN ('google', 'apple', 'outlook')),
  CONSTRAINT ck_mod_calendar_external_status
    CHECK (status IN ('connected', 'error', 'disabled')),
  CONSTRAINT ck_mod_calendar_external_revision
    CHECK (revision >= 1),
  CONSTRAINT uq_mod_calendar_external_calendar
    UNIQUE (calendar_id)
);

CREATE INDEX ix_mod_calendar_external_household
  ON mod_calendar.external_connections
  (household_id, status, provider);

ALTER TABLE mod_calendar.events
  ADD COLUMN external_connection_id uuid
    REFERENCES mod_calendar.external_connections(id) ON DELETE RESTRICT,
  ADD COLUMN remote_event_id text,
  ADD COLUMN remote_etag text,
  ADD COLUMN remote_updated_at timestamptz;

CREATE UNIQUE INDEX uq_mod_calendar_external_event
  ON mod_calendar.events (external_connection_id, remote_event_id)
  WHERE external_connection_id IS NOT NULL
    AND remote_event_id IS NOT NULL;

CREATE TABLE mod_calendar.oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  provider text NOT NULL,
  household_id uuid NOT NULL,
  context jsonb NOT NULL,
  code_verifier text NOT NULL,
  redirect_uri text NOT NULL,
  return_to text NOT NULL DEFAULT '/modules/calendar',
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_mod_calendar_oauth_provider
    CHECK (provider IN ('google', 'outlook'))
);

CREATE INDEX ix_mod_calendar_oauth_expiry
  ON mod_calendar.oauth_states (expires_at)
  WHERE used_at IS NULL;

CREATE TABLE mod_calendar.ics_feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  label text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX ix_mod_calendar_ics_household
  ON mod_calendar.ics_feeds (household_id, revoked_at);
