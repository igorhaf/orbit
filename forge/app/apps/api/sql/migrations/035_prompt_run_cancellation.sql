ALTER TABLE card_ai_runs DROP CONSTRAINT IF EXISTS card_ai_runs_status_check;
ALTER TABLE card_ai_runs ADD CONSTRAINT card_ai_runs_status_check CHECK(status IN ('queued','running','success','error','cancelled'));
