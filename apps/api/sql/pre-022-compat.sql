-- Temporary schema shim for historical migrations 004 and 022.
-- Migration 022 removes these tables before the application starts.
CREATE TABLE IF NOT EXISTS automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE TABLE IF NOT EXISTS automation_events (
  id bigserial PRIMARY KEY,
  board_id uuid,
  card_id uuid,
  kind text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}',
  chain uuid[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid REFERENCES automations(id) ON DELETE CASCADE,
  event_key text NOT NULL DEFAULT '',
  UNIQUE(automation_id, event_key)
);
