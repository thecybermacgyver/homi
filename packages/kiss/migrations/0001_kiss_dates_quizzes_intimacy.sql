CREATE TABLE IF NOT EXISTS mod_kiss.dates (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  idea_id text,
  title text NOT NULL,
  scheduled_for timestamptz(3),
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  done boolean NOT NULL DEFAULT false,
  author_person_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deleted_at timestamptz(3),
  CONSTRAINT ck_kiss_dates_revision CHECK (revision >= 1)
);
CREATE INDEX IF NOT EXISTS ix_kiss_dates_household
  ON mod_kiss.dates (household_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS mod_kiss.quiz_results (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  quiz_id text NOT NULL,
  answers jsonb NOT NULL,
  author_person_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deleted_at timestamptz(3),
  CONSTRAINT ck_kiss_quiz_results_revision CHECK (revision >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_kiss_quiz_results_author_quiz
  ON mod_kiss.quiz_results (household_id, author_person_id, quiz_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS mod_kiss.swipes (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  item_id text NOT NULL,
  choice text NOT NULL,
  author_person_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deleted_at timestamptz(3),
  CONSTRAINT ck_kiss_swipes_revision CHECK (revision >= 1),
  CONSTRAINT ck_kiss_swipes_choice CHECK (choice IN ('yes', 'no', 'maybe'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_kiss_swipes_author_item
  ON mod_kiss.swipes (household_id, author_person_id, item_id) WHERE deleted_at IS NULL;
