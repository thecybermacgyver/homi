ALTER TABLE core.audit_log
  ALTER COLUMN request_id TYPE text
  USING request_id::text;
