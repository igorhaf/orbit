CREATE TABLE IF NOT EXISTS delivery_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  kind varchar(24) NOT NULL CHECK (kind IN ('SSH_PRIVATE_KEY','SSH_PASSWORD','GIT_TOKEN','GIT_SSH_KEY')),
  encrypted_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,name)
);
CREATE INDEX IF NOT EXISTS delivery_credentials_owner_idx ON delivery_credentials(owner_id);

CREATE TABLE IF NOT EXISTS delivery_permissions (
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission varchar(80) NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,user_id,permission)
);

CREATE TABLE IF NOT EXISTS delivery_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  name varchar(120) NOT NULL,
  host text NOT NULL,
  port integer NOT NULL DEFAULT 22 CHECK (port BETWEEN 1 AND 65535),
  username varchar(120) NOT NULL,
  credential_id uuid NOT NULL REFERENCES delivery_credentials(id) ON DELETE RESTRICT,
  host_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,name)
);
CREATE INDEX IF NOT EXISTS delivery_servers_workspace_idx ON delivery_servers(workspace_id);

CREATE TABLE IF NOT EXISTS delivery_git_remotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES git_repositories(id) ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  url text NOT NULL,
  provider varchar(40),
  credential_id uuid REFERENCES delivery_credentials(id) ON DELETE RESTRICT,
  default_branch varchar(255),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(repository_id,name)
);
CREATE INDEX IF NOT EXISTS delivery_git_remotes_repository_idx ON delivery_git_remotes(repository_id);

CREATE TABLE IF NOT EXISTS delivery_environments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  slug varchar(80) NOT NULL,
  description text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(project_id,slug)
);
CREATE INDEX IF NOT EXISTS delivery_environments_project_idx ON delivery_environments(project_id);

CREATE TABLE IF NOT EXISTS delivery_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
  environment_id uuid NOT NULL REFERENCES delivery_environments(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  executor_type varchar(40) NOT NULL,
  server_id uuid REFERENCES delivery_servers(id) ON DELETE RESTRICT,
  repository_id uuid REFERENCES git_repositories(id) ON DELETE RESTRICT,
  working_directory text NOT NULL,
  git_remote_id uuid REFERENCES delivery_git_remotes(id) ON DELETE RESTRICT,
  git_branch varchar(255),
  build_commands jsonb NOT NULL DEFAULT '[]'::jsonb,
  restart_command text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(environment_id,name)
);
CREATE INDEX IF NOT EXISTS delivery_targets_project_environment_idx ON delivery_targets(project_id,environment_id);
CREATE INDEX IF NOT EXISTS delivery_targets_server_idx ON delivery_targets(server_id);

CREATE TABLE IF NOT EXISTS delivery_pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  description text NOT NULL DEFAULT '',
  trigger_type varchar(24) NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual','card.completed')),
  enabled boolean NOT NULL DEFAULT false,
  execution_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_pipelines_project_trigger_idx ON delivery_pipelines(project_id,trigger_type,enabled);

CREATE TABLE IF NOT EXISTS delivery_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES delivery_pipelines(id) ON DELETE CASCADE,
  type varchar(60) NOT NULL,
  name varchar(120) NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  position integer NOT NULL CHECK (position >= 0),
  timeout_ms integer NOT NULL DEFAULT 60000 CHECK (timeout_ms BETWEEN 1000 AND 1800000),
  failure_policy varchar(16) NOT NULL DEFAULT 'stop' CHECK (failure_policy IN ('stop','continue','retry')),
  max_attempts integer NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 5),
  bypass_policy varchar(24) NOT NULL DEFAULT 'deny' CHECK (bypass_policy IN ('deny','allow','allow_with_permission')),
  requires text[] NOT NULL DEFAULT '{}',
  UNIQUE(pipeline_id,position)
);
CREATE INDEX IF NOT EXISTS delivery_steps_pipeline_idx ON delivery_steps(pipeline_id,position);

CREATE TABLE IF NOT EXISTS delivery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES delivery_pipelines(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
  card_id uuid REFERENCES cards(id) ON DELETE SET NULL,
  triggered_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  trigger_type varchar(24) NOT NULL,
  mode varchar(12) NOT NULL CHECK (mode IN ('normal','bypass')),
  status varchar(24) NOT NULL CHECK (status IN ('queued','running','waiting_approval','success','failed','cancelled','rejected')),
  current_step_id uuid REFERENCES delivery_steps(id) ON DELETE SET NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  bypass_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  bypass_reason text,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_runs_project_created_idx ON delivery_runs(project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_runs_pipeline_status_idx ON delivery_runs(pipeline_id,status);
CREATE INDEX IF NOT EXISTS delivery_runs_mode_idx ON delivery_runs(mode);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_runs_card_trigger_idx ON delivery_runs(pipeline_id,card_id) WHERE trigger_type='card.completed';

CREATE TABLE IF NOT EXISTS delivery_step_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES delivery_runs(id) ON DELETE CASCADE,
  step_id uuid REFERENCES delivery_steps(id) ON DELETE SET NULL,
  step_snapshot jsonb NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('pending','running','waiting','success','failed','skipped','bypassed','rejected','cancelled')),
  attempt integer NOT NULL DEFAULT 1,
  started_at timestamptz,
  finished_at timestamptz,
  exit_code integer,
  stdout text NOT NULL DEFAULT '',
  stderr text NOT NULL DEFAULT '',
  error text,
  outputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(run_id,step_id)
);
CREATE INDEX IF NOT EXISTS delivery_step_runs_run_idx ON delivery_step_runs(run_id);

CREATE TABLE IF NOT EXISTS delivery_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES delivery_runs(id) ON DELETE CASCADE,
  step_id uuid REFERENCES delivery_steps(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  rejected_by uuid REFERENCES users(id) ON DELETE SET NULL,
  comment text,
  UNIQUE(run_id,step_id)
);

CREATE TABLE IF NOT EXISTS delivery_audit (
  id bigserial PRIMARY KEY,
  run_id uuid REFERENCES delivery_runs(id) ON DELETE CASCADE,
  step_id uuid REFERENCES delivery_steps(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event varchar(80) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_audit_run_created_idx ON delivery_audit(run_id,created_at);

CREATE TABLE IF NOT EXISTS delivery_target_locks (
  target_id uuid PRIMARY KEY REFERENCES delivery_targets(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES delivery_runs(id) ON DELETE CASCADE,
  acquired_at timestamptz NOT NULL DEFAULT now()
);
