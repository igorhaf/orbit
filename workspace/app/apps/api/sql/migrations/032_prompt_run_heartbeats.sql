ALTER TABLE card_ai_runs ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;
UPDATE card_ai_runs SET heartbeat_at=COALESCE(started_at,created_at,now()) WHERE heartbeat_at IS NULL;
ALTER TABLE card_ai_runs ALTER COLUMN heartbeat_at SET DEFAULT now();
ALTER TABLE card_ai_runs ALTER COLUMN heartbeat_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS card_ai_runs_heartbeat_idx ON card_ai_runs(heartbeat_at) WHERE status IN ('queued','running');
