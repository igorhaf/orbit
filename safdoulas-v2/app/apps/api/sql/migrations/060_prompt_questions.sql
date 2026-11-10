ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_ai_execution_mode_check;
ALTER TABLE cards ADD CONSTRAINT cards_ai_execution_mode_check CHECK (ai_execution_mode IN ('planning','bypass','question'));
ALTER TABLE card_ai_runs DROP CONSTRAINT IF EXISTS card_ai_runs_status_check;
ALTER TABLE card_ai_runs ADD CONSTRAINT card_ai_runs_status_check CHECK (status IN ('queued','running','waiting_answer','success','error','cancelled'));
