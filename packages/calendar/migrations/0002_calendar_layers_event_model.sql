CREATE INDEX ix_mod_calendar_events_timed_range
  ON mod_calendar.events
  (household_id, starts_at, ends_at)
  WHERE deleted_at IS NULL AND all_day = false;

CREATE INDEX ix_mod_calendar_events_all_day_range
  ON mod_calendar.events
  (household_id, start_date, end_date_exclusive)
  WHERE deleted_at IS NULL AND all_day = true;
