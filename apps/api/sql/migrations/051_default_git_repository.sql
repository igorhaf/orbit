ALTER TABLE ai_projects
  ADD COLUMN IF NOT EXISTS default_git_repository_id uuid REFERENCES git_repositories(id) ON DELETE SET NULL;

UPDATE ai_projects p
SET default_git_repository_id = (
  SELECT r.id FROM git_repositories r
  WHERE r.project_id = p.id
  ORDER BY r.created_at, r.id
  LIMIT 1
)
WHERE p.default_git_repository_id IS NULL
  AND EXISTS (SELECT 1 FROM git_repositories r WHERE r.project_id = p.id);
