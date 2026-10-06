ALTER TABLE cards ADD COLUMN IF NOT EXISTS ai_execution_mode varchar(16) NOT NULL DEFAULT 'bypass';
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_ai_execution_mode_check;
ALTER TABLE cards ADD CONSTRAINT cards_ai_execution_mode_check CHECK (ai_execution_mode IN ('planning','bypass'));
