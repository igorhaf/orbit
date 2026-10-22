ALTER TABLE ai_projects
  ADD COLUMN IF NOT EXISTS is_internal_orbit boolean NOT NULL DEFAULT false;

UPDATE ai_projects
SET is_internal_orbit = false,
    is_native = false,
    updated_at = now()
WHERE is_native = true;
