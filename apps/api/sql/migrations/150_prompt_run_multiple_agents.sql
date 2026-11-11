ALTER TABLE card_ai_runs
  ADD COLUMN IF NOT EXISTS multiple_agents boolean NOT NULL DEFAULT false;
