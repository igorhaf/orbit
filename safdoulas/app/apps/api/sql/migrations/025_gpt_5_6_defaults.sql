UPDATE users
SET ai_default_model = CASE ai_default_model
  WHEN 'gpt-6-sol' THEN 'gpt-5.6-sol'
  ELSE 'gpt-5.6-luna'
END
WHERE ai_default_model IS NULL
   OR ai_default_model IN ('gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol');

UPDATE ai_projects SET ai_default_model = CASE ai_default_model
  WHEN 'gpt-6-sol' THEN 'gpt-5.6-sol'
  ELSE 'gpt-5.6-luna'
END
WHERE ai_default_model IN ('gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol');

UPDATE boards SET ai_default_model = CASE ai_default_model
  WHEN 'gpt-6-sol' THEN 'gpt-5.6-sol'
  ELSE 'gpt-5.6-luna'
END
WHERE ai_default_model IN ('gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol');

UPDATE cards SET ai_model = CASE ai_model
  WHEN 'gpt-6-sol' THEN 'gpt-5.6-sol'
  ELSE 'gpt-5.6-luna'
END
WHERE ai_model IN ('gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol');

ALTER TABLE users ALTER COLUMN ai_default_model SET DEFAULT 'gpt-5.6-luna';
