ALTER TABLE card_ai_runs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS card_ai_runs_queue_idx ON card_ai_runs(card_id,created_at,id) WHERE status='queued';
