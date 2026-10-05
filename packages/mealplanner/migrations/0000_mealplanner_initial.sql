CREATE TABLE IF NOT EXISTS mod_mealplanner.meals (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  meal_date date NOT NULL,
  slot text NOT NULL,
  kind text NOT NULL DEFAULT 'meal',
  title text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  servings integer,
  cook_person_id uuid,
  status text NOT NULL DEFAULT 'planned',
  recipe jsonb,
  position integer NOT NULL DEFAULT 0,
  series_id uuid,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deleted_at timestamptz(3),
  CONSTRAINT ck_mealplanner_meals_revision CHECK (revision >= 1),
  CONSTRAINT ck_mealplanner_meals_slot CHECK (slot IN ('breakfast', 'lunch', 'dinner', 'snack')),
  CONSTRAINT ck_mealplanner_meals_kind CHECK (kind IN ('meal', 'eating-out', 'leftovers', 'takeout', 'skip')),
  CONSTRAINT ck_mealplanner_meals_status CHECK (status IN ('planned', 'cooked')),
  CONSTRAINT ck_mealplanner_meals_servings CHECK (servings IS NULL OR (servings >= 1 AND servings <= 99))
);

CREATE INDEX IF NOT EXISTS ix_mealplanner_meals_household_date
  ON mod_mealplanner.meals (household_id, meal_date, slot, position)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS mod_mealplanner.ideas (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  title text NOT NULL,
  notes text NOT NULL DEFAULT '',
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  recipe jsonb,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deleted_at timestamptz(3),
  CONSTRAINT ck_mealplanner_ideas_revision CHECK (revision >= 1)
);

CREATE INDEX IF NOT EXISTS ix_mealplanner_ideas_household_active
  ON mod_mealplanner.ideas (household_id, lower(title))
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS mod_mealplanner.plan_settings (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  config jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  CONSTRAINT ck_mealplanner_settings_revision CHECK (revision >= 1)
);
