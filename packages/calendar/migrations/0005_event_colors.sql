ALTER TABLE mod_calendar.calendars
  DROP CONSTRAINT IF EXISTS ck_calendar_calendars_color;

ALTER TABLE mod_calendar.calendars
  DROP CONSTRAINT IF EXISTS ck_calendar_calendars_kind;

UPDATE mod_calendar.calendars
SET color = CASE
  WHEN lower(color) IN (
    'red','orange','yellow','lime','green','dark green','aqua','cyan',
    'blue','navy','purple','violet','pink','magenta','brown','black'
  ) THEN lower(color)
  WHEN lower(color) IN ('sage','forest','emerald','mint') THEN 'green'
  WHEN lower(color) IN ('teal','turquoise') THEN 'aqua'
  WHEN lower(color) IN ('indigo','midnight') THEN 'navy'
  WHEN lower(color) IN ('lavender','lilac') THEN 'violet'
  WHEN lower(color) IN ('rose','coral') THEN 'pink'
  WHEN lower(color) IN ('grey','gray','charcoal') THEN 'black'
  ELSE 'blue'
END;

ALTER TABLE mod_calendar.calendars
  ADD CONSTRAINT ck_calendar_calendars_color
  CHECK (color IN (
    'red','orange','yellow','lime','green','dark green','aqua','cyan',
    'blue','navy','purple','violet','pink','magenta','brown','black'
  ));

ALTER TABLE mod_calendar.calendars
  ADD CONSTRAINT ck_calendar_calendars_kind
  CHECK (kind IN ('local', 'external'));

ALTER TABLE mod_calendar.events
  ALTER COLUMN starts_at DROP NOT NULL,
  ALTER COLUMN ends_at DROP NOT NULL;

UPDATE mod_calendar.events
SET starts_at = NULL,
    ends_at = NULL
WHERE all_day = true;

ALTER TABLE mod_calendar.events
  DROP CONSTRAINT IF EXISTS ck_calendar_events_date_shape;

ALTER TABLE mod_calendar.events
  DROP CONSTRAINT IF EXISTS ck_mod_calendar_event_dates;

ALTER TABLE mod_calendar.events
  ADD CONSTRAINT ck_calendar_events_date_shape
  CHECK (
    (
      all_day = true
      AND start_date IS NOT NULL
      AND end_date_exclusive IS NOT NULL
      AND end_date_exclusive > start_date
      AND starts_at IS NULL
      AND ends_at IS NULL
    )
    OR
    (
      all_day = false
      AND starts_at IS NOT NULL
      AND ends_at IS NOT NULL
      AND ends_at > starts_at
      AND start_date IS NULL
      AND end_date_exclusive IS NULL
    )
  );

ALTER TABLE mod_calendar.events
  ADD COLUMN color text;

UPDATE mod_calendar.events AS e
SET color = c.color
FROM mod_calendar.calendars AS c
WHERE c.id = e.calendar_id
  AND e.color IS NULL;

UPDATE mod_calendar.events
SET color = 'blue'
WHERE color IS NULL;

ALTER TABLE mod_calendar.events
  ALTER COLUMN color SET NOT NULL,
  ALTER COLUMN color SET DEFAULT 'blue';

ALTER TABLE mod_calendar.events
  DROP CONSTRAINT IF EXISTS ck_mod_calendar_event_color;

ALTER TABLE mod_calendar.events
  DROP CONSTRAINT IF EXISTS ck_calendar_events_color;

ALTER TABLE mod_calendar.events
  ADD CONSTRAINT ck_calendar_events_color
  CHECK (color IN (
    'red','orange','yellow','lime','green','dark green','aqua','cyan',
    'blue','navy','purple','violet','pink','magenta','brown','black'
  ));

UPDATE mod_calendar.events AS e
SET recurrence_overrides = COALESCE((
  SELECT jsonb_agg(
    CASE
      WHEN item ->> 'action' = 'replace'
       AND jsonb_typeof(item -> 'replacement') = 'object'
      THEN jsonb_set(
        item,
        '{replacement,color}',
        to_jsonb(e.color),
        true
      )
      ELSE item
    END
    ORDER BY ordinal
  )
  FROM jsonb_array_elements(e.recurrence_overrides)
    WITH ORDINALITY AS override_item(item, ordinal)
), '[]'::jsonb)
WHERE jsonb_array_length(e.recurrence_overrides) > 0;
