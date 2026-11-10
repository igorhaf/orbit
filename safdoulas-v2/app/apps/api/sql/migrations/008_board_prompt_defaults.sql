ALTER TABLE boards
  ADD COLUMN IF NOT EXISTS ai_default_project_id uuid REFERENCES ai_projects(id) ON DELETE SET NULL;

