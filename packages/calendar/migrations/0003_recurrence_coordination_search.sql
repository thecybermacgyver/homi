CREATE INDEX ix_mod_calendar_events_people
  ON mod_calendar.events USING gin (person_ids);

CREATE INDEX ix_mod_calendar_events_recurrence
  ON mod_calendar.events USING gin (recurrence);

CREATE INDEX ix_mod_calendar_events_title_search
  ON mod_calendar.events
  USING gin (to_tsvector('simple', title));
