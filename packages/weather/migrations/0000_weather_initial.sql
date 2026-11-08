-- Saved places belong to one member (user_id). Other members of the household
-- never read them: every read in the server filters by the requesting user.
CREATE TABLE IF NOT EXISTS mod_weather.places (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  region text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT '',
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  card_slot smallint,
  position integer NOT NULL DEFAULT 0,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deleted_at timestamptz(3),
  CONSTRAINT ck_weather_places_revision CHECK (revision >= 1),
  CONSTRAINT ck_weather_places_latitude CHECK (latitude >= -90 AND latitude <= 90),
  CONSTRAINT ck_weather_places_longitude CHECK (longitude >= -180 AND longitude <= 180),
  CONSTRAINT ck_weather_places_card_slot CHECK (card_slot IS NULL OR (card_slot >= 1 AND card_slot <= 5)),
  CONSTRAINT ck_weather_places_position CHECK (position >= 0 AND position <= 1000)
);

CREATE INDEX IF NOT EXISTS ix_weather_places_user_active
  ON mod_weather.places (household_id, user_id, position, created_at)
  WHERE deleted_at IS NULL;

-- One preferences row per member; its id is that member's user id.
CREATE TABLE IF NOT EXISTS mod_weather.preferences (
  household_id uuid NOT NULL,
  user_id uuid NOT NULL,
  id uuid NOT NULL,
  config jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id, id),
  CONSTRAINT ck_weather_preferences_revision CHECK (revision >= 1),
  CONSTRAINT ck_weather_preferences_own_id CHECK (id = user_id)
);
