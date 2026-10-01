ALTER TABLE card_ai_runs ADD COLUMN IF NOT EXISTS file_changes jsonb NOT NULL DEFAULT '[]'::jsonb;
