ALTER TABLE users ALTER COLUMN ai_default_model SET DEFAULT 'gpt-6-luna';
ALTER TABLE users ALTER COLUMN ai_default_effort SET DEFAULT 'high';

UPDATE users
SET ai_default_model = 'gpt-6-luna', ai_default_effort = 'high';

UPDATE ai_projects
SET ai_default_model = CASE ai_default_model
  WHEN 'gpt-5.6-sol' THEN 'gpt-6.1-sol'
  WHEN 'gpt-5.6-terra' THEN 'gpt-6.1-sol'
  ELSE 'gpt-6-luna'
END
WHERE ai_default_model IN ('gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-sol');

UPDATE boards
SET ai_default_model = CASE ai_default_model
  WHEN 'gpt-5.6-sol' THEN 'gpt-6.1-sol'
  WHEN 'gpt-5.6-terra' THEN 'gpt-6.1-sol'
  ELSE 'gpt-6-luna'
END
WHERE ai_default_model IN ('gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-sol');

UPDATE cards
SET ai_model = CASE ai_model
  WHEN 'gpt-5.6-sol' THEN 'gpt-6.1-sol'
  WHEN 'gpt-5.6-terra' THEN 'gpt-6.1-sol'
  ELSE 'gpt-6-luna'
END
WHERE ai_model IN ('gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-sol');

UPDATE card_ai_comment_jobs
SET model = CASE model
  WHEN 'gpt-5.6-sol' THEN 'gpt-6.1-sol'
  WHEN 'gpt-5.6-terra' THEN 'gpt-6.1-sol'
  ELSE 'gpt-6-luna'
END
WHERE status = 'queued'
  AND model IN ('gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-sol');
