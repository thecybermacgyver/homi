-- A quiz result now belongs to a day (eight statements a day) instead of one
-- result per quiz. Earlier rows keep their data and a NULL day.
ALTER TABLE mod_kiss.quiz_results ADD COLUMN IF NOT EXISTS day date;

DROP INDEX IF EXISTS mod_kiss.ux_kiss_quiz_results_author_quiz;

CREATE UNIQUE INDEX IF NOT EXISTS ux_kiss_quiz_results_author_day
  ON mod_kiss.quiz_results (household_id, author_person_id, day)
  WHERE deleted_at IS NULL AND day IS NOT NULL;
