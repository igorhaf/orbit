ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS event_version integer;

UPDATE webhook_events
SET event_version=1
WHERE event_version IS NULL;

ALTER TABLE webhook_events
  ALTER COLUMN event_version SET DEFAULT 1,
  ALTER COLUMN event_version SET NOT NULL;

ALTER TABLE webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_event_version_check;

ALTER TABLE webhook_events
  ADD CONSTRAINT webhook_events_event_version_check CHECK (event_version > 0);
