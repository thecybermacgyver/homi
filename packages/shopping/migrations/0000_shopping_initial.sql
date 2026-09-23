CREATE TABLE IF NOT EXISTS mod_shopping.items (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  name text NOT NULL,
  quantity text NOT NULL DEFAULT '1',
  store text NOT NULL DEFAULT 'Any store',
  aisle text NOT NULL,
  assigned_to text,
  checked boolean NOT NULL DEFAULT false,
  checked_by text,
  checked_at timestamptz(3),
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deleted_at timestamptz(3),
  CONSTRAINT ck_shopping_items_revision CHECK (revision >= 1),
  CONSTRAINT ck_shopping_items_checked_metadata CHECK (
    (checked AND checked_at IS NOT NULL)
    OR (NOT checked AND checked_at IS NULL AND checked_by IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS ix_shopping_items_household_active
  ON mod_shopping.items (
    household_id,
    checked,
    store,
    aisle,
    created_at
  )
  WHERE deleted_at IS NULL;
