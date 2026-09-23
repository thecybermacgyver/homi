CREATE TABLE mod_calendar.calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL,
  kind text NOT NULL DEFAULT 'local',
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT ck_mod_calendar_calendars_revision
    CHECK (revision >= 1)
);

CREATE TABLE mod_calendar.settings (
  household_id uuid PRIMARY KEY,
  state text NOT NULL DEFAULT 'unconfigured',
  default_view text NOT NULL DEFAULT 'month',
  week_start text NOT NULL DEFAULT 'sunday',
  time_zone text NOT NULL DEFAULT 'UTC',
  default_reminder text NOT NULL DEFAULT 'none',
  revision bigint NOT NULL DEFAULT 1,
  default_calendar_id uuid NOT NULL
    REFERENCES mod_calendar.calendars(id) ON DELETE RESTRICT,
  CONSTRAINT ck_mod_calendar_settings_state
    CHECK (state IN ('unconfigured', 'configured')),
  CONSTRAINT ck_mod_calendar_settings_revision
    CHECK (revision >= 1)
);

CREATE TABLE mod_calendar.events (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  title text NOT NULL,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  location text,
  notes text,
  revision bigint NOT NULL DEFAULT 1,
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  calendar_id uuid NOT NULL
    REFERENCES mod_calendar.calendars(id) ON DELETE RESTRICT,
  time_zone text NOT NULL,
  start_date date,
  end_date_exclusive date,
  description text,
  recurrence jsonb,
  recurrence_overrides jsonb NOT NULL DEFAULT '[]'::jsonb,
  person_ids uuid[] NOT NULL DEFAULT '{}',
  reminder_minutes integer[] NOT NULL DEFAULT '{}',
  transport jsonb NOT NULL DEFAULT
    '{"mode":"none","notes":null,"pickupPersonId":null,"dropoffPersonId":null}'::jsonb,
  CONSTRAINT ck_mod_calendar_events_revision
    CHECK (revision >= 1),
  CONSTRAINT ck_mod_calendar_event_dates
    CHECK (
      (
        all_day = true
        AND start_date IS NOT NULL
        AND end_date_exclusive IS NOT NULL
        AND starts_at IS NULL
        AND ends_at IS NULL
      )
      OR
      (
        all_day = false
        AND starts_at IS NOT NULL
        AND ends_at IS NOT NULL
        AND start_date IS NULL
        AND end_date_exclusive IS NULL
      )
    )
);
