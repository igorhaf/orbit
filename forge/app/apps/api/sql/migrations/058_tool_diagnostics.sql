CREATE INDEX IF NOT EXISTS card_ai_runs_user_created_idx ON card_ai_runs(user_id,created_at DESC,id DESC);
