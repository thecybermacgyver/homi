-- Notification delivery: a notification written by a module is shown in the
-- household's inbox and, where the member has turned it on, pushed to their
-- devices. push_sent_at records that push delivery has been attempted so
-- that a notification is never pushed twice.
ALTER TABLE core.notifications
  ADD COLUMN IF NOT EXISTS push_sent_at timestamp(3) with time zone;

-- Notifications that exist now were never pushed and must not arrive as a
-- burst of old reminders the first time a device subscribes.
UPDATE core.notifications SET push_sent_at = now() WHERE push_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_core_notifications_push_pending
  ON core.notifications (created_at)
  WHERE push_sent_at IS NULL;

-- The server's Web Push identity (VAPID). One row, created on first use.
CREATE TABLE IF NOT EXISTS core.push_server_keys (
  id smallint PRIMARY KEY,
  public_key text NOT NULL,
  private_key text NOT NULL,
  created_at timestamp(3) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ck_core_push_server_keys_single CHECK (id = 1)
);
