ALTER TABLE card_ai_runs ADD COLUMN IF NOT EXISTS worker_id text;
CREATE INDEX IF NOT EXISTS card_ai_runs_worker_idx ON card_ai_runs(worker_id) WHERE status IN ('queued','running');
