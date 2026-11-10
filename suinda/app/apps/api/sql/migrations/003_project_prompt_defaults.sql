ALTER TABLE ai_projects ADD COLUMN IF NOT EXISTS ai_default_model varchar(100);
ALTER TABLE ai_projects ADD COLUMN IF NOT EXISTS ai_default_effort varchar(16);
ALTER TABLE ai_projects DROP CONSTRAINT IF EXISTS ai_projects_ai_default_effort_check;
ALTER TABLE ai_projects ADD CONSTRAINT ai_projects_ai_default_effort_check
  CHECK(ai_default_effort IN ('low','medium','high','xhigh'));
