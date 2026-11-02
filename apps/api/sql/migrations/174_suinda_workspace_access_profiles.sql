CREATE TABLE IF NOT EXISTS suinda_workspace_access_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  permissions text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS suinda_access_profile_name_idx ON suinda_workspace_access_profiles(workspace_id, lower(name));
CREATE TABLE IF NOT EXISTS suinda_workspace_access_profile_members (
  workspace_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  user_id uuid NOT NULL,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, profile_id, user_id),
  FOREIGN KEY (workspace_id, profile_id) REFERENCES suinda_workspace_access_profiles(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS suinda_access_profile_members_user_idx ON suinda_workspace_access_profile_members(workspace_id, user_id);
