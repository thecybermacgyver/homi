CREATE TABLE IF NOT EXISTS mod_noticeboard.notices (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#f6dd7a',
  image text,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  pinned boolean NOT NULL DEFAULT true,
  pos_x double precision NOT NULL DEFAULT 0.1,
  pos_y double precision NOT NULL DEFAULT 0.1,
  width double precision NOT NULL DEFAULT 0.4,
  rotation double precision NOT NULL DEFAULT 0,
  z integer NOT NULL DEFAULT 0,
  author_person_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deleted_at timestamptz(3),
  CONSTRAINT ck_noticeboard_notices_revision CHECK (revision >= 1),
  CONSTRAINT ck_noticeboard_notices_color CHECK (color ~ '^#[0-9a-f]{6}$'),
  CONSTRAINT ck_noticeboard_notices_position CHECK (
    pos_x >= 0 AND pos_x <= 1 AND pos_y >= 0 AND pos_y <= 1
    AND width >= 0.15 AND width <= 0.9
    AND rotation >= -8 AND rotation <= 8
  )
);

CREATE INDEX IF NOT EXISTS ix_noticeboard_notices_household_active
  ON mod_noticeboard.notices (household_id, created_at DESC)
  WHERE deleted_at IS NULL;
