CREATE TABLE IF NOT EXISTS mod_kiss.partnerships (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  partner_a uuid NOT NULL,
  partner_b uuid NOT NULL,
  phase text NOT NULL DEFAULT 'dating',
  started_on date NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deleted_at timestamptz(3),
  CONSTRAINT ck_kiss_partnerships_revision CHECK (revision >= 1),
  CONSTRAINT ck_kiss_partnerships_distinct CHECK (partner_a <> partner_b),
  CONSTRAINT ck_kiss_partnerships_phase CHECK (phase IN ('dating', 'cohabiting', 'married'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_kiss_partnerships_household
  ON mod_kiss.partnerships (household_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS mod_kiss.answers (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  day date NOT NULL,
  question_id text NOT NULL,
  body text NOT NULL,
  resonance smallint NOT NULL,
  author_person_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deleted_at timestamptz(3),
  CONSTRAINT ck_kiss_answers_revision CHECK (revision >= 1),
  CONSTRAINT ck_kiss_answers_resonance CHECK (resonance BETWEEN 1 AND 5)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_kiss_answers_author_day
  ON mod_kiss.answers (household_id, author_person_id, day) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS mod_kiss.checkins (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  day date NOT NULL,
  battery smallint NOT NULL,
  desire smallint NOT NULL,
  stress smallint NOT NULL,
  author_person_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deleted_at timestamptz(3),
  CONSTRAINT ck_kiss_checkins_revision CHECK (revision >= 1),
  CONSTRAINT ck_kiss_checkins_levels CHECK (
    battery BETWEEN 0 AND 100 AND desire BETWEEN 0 AND 100 AND stress BETWEEN 0 AND 100
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_kiss_checkins_author_day
  ON mod_kiss.checkins (household_id, author_person_id, day) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS mod_kiss.notes (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  body text NOT NULL,
  author_person_id uuid NOT NULL,
  recipient_person_id uuid NOT NULL,
  read_at timestamptz(3),
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deleted_at timestamptz(3),
  CONSTRAINT ck_kiss_notes_revision CHECK (revision >= 1)
);
CREATE INDEX IF NOT EXISTS ix_kiss_notes_household
  ON mod_kiss.notes (household_id, created_at DESC) WHERE deleted_at IS NULL;
