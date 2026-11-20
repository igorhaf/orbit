ALTER TABLE card_ai_runs ADD COLUMN IF NOT EXISTS source varchar(16) NOT NULL DEFAULT 'description';
ALTER TABLE card_ai_runs ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE card_ai_runs DROP CONSTRAINT IF EXISTS card_ai_runs_source_check;
ALTER TABLE card_ai_runs ADD CONSTRAINT card_ai_runs_source_check CHECK(source IN ('description','comment'));
