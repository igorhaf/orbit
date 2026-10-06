CREATE TABLE IF NOT EXISTS git_repositories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  relative_path text NOT NULL DEFAULT '.',
  remote_name varchar(80) NOT NULL DEFAULT 'origin',
  branches text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, relative_path),
  CHECK (cardinality(branches) > 0)
);
CREATE INDEX IF NOT EXISTS git_repositories_project_idx ON git_repositories(project_id);

CREATE TABLE IF NOT EXISTS git_pipeline_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repository_id uuid NOT NULL REFERENCES git_repositories(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  provider varchar(24) NOT NULL CHECK (provider IN ('github_actions','gitlab_ci','bamboo')),
  base_url text NOT NULL,
  external_project varchar(300) NOT NULL,
  pipeline_ref varchar(300) NOT NULL,
  branches text[] NOT NULL,
  stages text[] NOT NULL DEFAULT '{}',
  credentials_encrypted text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(branches) > 0)
);
CREATE INDEX IF NOT EXISTS git_pipeline_targets_repository_idx ON git_pipeline_targets(repository_id);

CREATE TABLE IF NOT EXISTS git_column_stages (
  list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES git_pipeline_targets(id) ON DELETE CASCADE,
  stage_key varchar(120) NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(list_id,target_id)
);

CREATE TABLE IF NOT EXISTS git_card_commits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  repository_id uuid NOT NULL REFERENCES git_repositories(id) ON DELETE CASCADE,
  sha varchar(40) NOT NULL,
  branch varchar(255) NOT NULL,
  title text NOT NULL,
  comments text NOT NULL DEFAULT '',
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  merge boolean NOT NULL DEFAULT false,
  url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(card_id,repository_id,sha)
);
CREATE INDEX IF NOT EXISTS git_card_commits_card_idx ON git_card_commits(card_id,created_at DESC);

CREATE TABLE IF NOT EXISTS git_pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL REFERENCES git_pipeline_targets(id) ON DELETE CASCADE,
  card_id uuid REFERENCES cards(id) ON DELETE SET NULL,
  stage_key varchar(120),
  branch varchar(255) NOT NULL,
  external_run_id text,
  status varchar(16) NOT NULL CHECK (status IN ('queued','running','success','failed')),
  logs text NOT NULL DEFAULT '',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS git_pipeline_runs_target_idx ON git_pipeline_runs(target_id,created_at DESC);
