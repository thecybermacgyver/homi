CREATE TABLE IF NOT EXISTS mod_starter.household_settings (
  household_id uuid PRIMARY KEY,
  board_label text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT ck_starter_household_settings_revision
    CHECK (revision >= 1)
);

CREATE TABLE IF NOT EXISTS mod_starter.items (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  title text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deleted_at timestamptz(3),
  CONSTRAINT ck_starter_items_revision CHECK (revision >= 1)
);

CREATE INDEX IF NOT EXISTS ix_starter_items_household
  ON mod_starter.items (household_id, id);
