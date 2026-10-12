ALTER TABLE delivery_runs ADD COLUMN IF NOT EXISTS trigger_key uuid;
DROP INDEX IF EXISTS delivery_runs_card_trigger_idx;
CREATE UNIQUE INDEX IF NOT EXISTS delivery_runs_trigger_key_idx ON delivery_runs(pipeline_id,trigger_key) WHERE trigger_key IS NOT NULL;
