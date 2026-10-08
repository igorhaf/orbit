ALTER TABLE card_ai_runs
  ADD COLUMN IF NOT EXISTS suggested_commit_type varchar(30),
  ADD COLUMN IF NOT EXISTS suggested_commit_name varchar(100),
  ADD COLUMN IF NOT EXISTS suggested_commit_summary varchar(360);
