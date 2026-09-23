CREATE INDEX ix_mod_calendar_calendars_household
  ON mod_calendar.calendars (household_id, deleted_at, name);

CREATE INDEX ix_mod_calendar_events_household_calendar
  ON mod_calendar.events
  (household_id, calendar_id, deleted_at);
