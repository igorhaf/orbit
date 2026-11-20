-- Worker and resource diagnostics only; physical exclusivity lives in Orbit Core.
ALTER TABLE card_runs ADD COLUMN worker_id text;
ALTER TABLE card_ai_runs ADD COLUMN write_coordination jsonb NOT NULL DEFAULT '{}'::jsonb;
