ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_default_model varchar(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_default_effort varchar(16);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_ai_default_effort_check;
ALTER TABLE users ADD CONSTRAINT users_ai_default_effort_check
  CHECK(ai_default_effort IN ('low','medium','high','xhigh'));
