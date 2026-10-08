CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL,
  email varchar(255) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{"theme":"light","notifications":true,"browserNotifications":false,"shortcuts":true,"compactCards":false}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_default_model varchar(100);
ALTER TABLE users ALTER COLUMN ai_default_model SET DEFAULT 'gpt-6-luna';
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_default_effort varchar(16) DEFAULT 'high' CHECK(ai_default_effort IN ('low','medium','high','xhigh'));
CREATE TABLE IF NOT EXISTS notebooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(160) NOT NULL DEFAULT 'Anotações',
  content_html text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notebooks_owner_updated_idx ON notebooks(owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS vault_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(300) NOT NULL,
  category varchar(48) NOT NULL,
  notes text NOT NULL DEFAULT '',
  secret_data text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vault_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(48) NOT NULL,
  icon varchar(32) NOT NULL DEFAULT 'LockKeyhole',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,name)
);
CREATE TABLE IF NOT EXISTS plugin_settings (
  plugin_id varchar(100) PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE vault_categories
  ADD COLUMN IF NOT EXISTS icon varchar(32) NOT NULL DEFAULT 'LockKeyhole',
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS vault_categories_owner_idx ON vault_categories(owner_id,name);
CREATE INDEX IF NOT EXISTS vault_categories_owner_position_idx ON vault_categories(owner_id,position,id);
CREATE INDEX IF NOT EXISTS vault_items_owner_updated_idx ON vault_items(owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(160) NOT NULL,
  background varchar(32) NOT NULL DEFAULT 'blue',
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starred boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE boards ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS favorite_position double precision;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE boards ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS is_inbox boolean NOT NULL DEFAULT false;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS is_collection boolean NOT NULL DEFAULT false;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS ai_default_model varchar(100);
ALTER TABLE boards ADD COLUMN IF NOT EXISTS ai_default_effort varchar(16);
CREATE UNIQUE INDEX IF NOT EXISTS boards_owner_inbox_idx ON boards(owner_id) WHERE is_inbox;
CREATE UNIQUE INDEX IF NOT EXISTS boards_owner_collection_idx ON boards(owner_id) WHERE is_collection;
CREATE TABLE IF NOT EXISTS board_media (
  board_id uuid PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  mime_type varchar(32) NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS board_members (
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(16) NOT NULL DEFAULT 'member',
  PRIMARY KEY (board_id, user_id)
);
CREATE TABLE IF NOT EXISTS lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  title varchar(160) NOT NULL,
  position double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE lists ADD COLUMN IF NOT EXISTS color varchar(32);
ALTER TABLE lists ADD COLUMN IF NOT EXISTS collapsed boolean NOT NULL DEFAULT false;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS is_completion_list boolean NOT NULL DEFAULT false;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS parent_list_id uuid REFERENCES lists(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS lists_board_position_idx ON lists(board_id, position);
CREATE INDEX IF NOT EXISTS lists_parent_position_idx ON lists(board_id,parent_list_id,position);
CREATE TABLE IF NOT EXISTS cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  title varchar(300) NOT NULL,
  description text NOT NULL DEFAULT '',
  position double precision NOT NULL DEFAULT 0,
  due_date timestamptz,
  cover_color varchar(32),
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS url_token uuid DEFAULT gen_random_uuid();
UPDATE cards SET url_token=gen_random_uuid() WHERE url_token IS NULL;
ALTER TABLE cards ALTER COLUMN url_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cards_url_token_unique_idx ON cards(url_token);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS start_date timestamptz;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS reminder_minutes integer;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS recurrence varchar(16);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS cover_attachment_id uuid;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS cover_size varchar(8) NOT NULL DEFAULT 'normal';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS kind varchar(16) NOT NULL DEFAULT 'normal';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS target_board_id uuid REFERENCES boards(id) ON DELETE SET NULL;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS link_url text;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS mirror_source_id uuid REFERENCES cards(id) ON DELETE CASCADE;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS mirror_expanded boolean NOT NULL DEFAULT true;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS ai_project_id uuid;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS ai_model varchar(100);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS ai_effort varchar(16);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS ai_execution_mode varchar(16) NOT NULL DEFAULT 'bypass';
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_ai_execution_mode_check;
ALTER TABLE cards ADD CONSTRAINT cards_ai_execution_mode_check CHECK (ai_execution_mode IN ('planning','bypass'));
ALTER TABLE cards ADD COLUMN IF NOT EXISTS schedule_start_at timestamptz;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS schedule_end_at timestamptz;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS schedule_all_day boolean NOT NULL DEFAULT false;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS schedule_time_zone varchar(100);
ALTER TABLE vault_items ADD COLUMN IF NOT EXISTS card_id uuid UNIQUE REFERENCES cards(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS cards_mirror_source_idx ON cards(mirror_source_id) WHERE mirror_source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cards_list_position_idx ON cards(list_id, position);
CREATE TABLE IF NOT EXISTS labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL DEFAULT '',
  color varchar(32) NOT NULL DEFAULT 'green'
);
CREATE TABLE IF NOT EXISTS card_labels (
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, label_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_label text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS author_label text;
CREATE TABLE IF NOT EXISTS comment_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  kind varchar(8) NOT NULL CHECK (kind IN ('file','card','board')),
  name varchar(255) NOT NULL,
  url text,
  target_id uuid,
  mime_type varchar(120),
  size_bytes integer,
  data bytea,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comment_attachments_comment_idx ON comment_attachments(comment_id,created_at);
CREATE TABLE IF NOT EXISTS card_watchers (
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(card_id,user_id)
);
CREATE TABLE IF NOT EXISTS list_watchers (
  list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(list_id,user_id)
);
CREATE TABLE IF NOT EXISTS board_watchers (
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(board_id,user_id)
);
CREATE TABLE IF NOT EXISTS checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  text varchar(300) NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  position double precision NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  title varchar(160) NOT NULL DEFAULT 'Checklist',
  position integer NOT NULL DEFAULT 0
);
UPDATE checklists SET title='Checklist' WHERE lower(trim(title))='checklist sugerido por ia';
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS checklist_id uuid REFERENCES checklists(id) ON DELETE CASCADE;
INSERT INTO checklists(card_id,title,position)
SELECT DISTINCT ci.card_id,'Checklist',0 FROM checklist_items ci
WHERE ci.checklist_id IS NULL AND NOT EXISTS (SELECT 1 FROM checklists cl WHERE cl.card_id=ci.card_id);
UPDATE checklist_items ci SET checklist_id=(SELECT cl.id FROM checklists cl WHERE cl.card_id=ci.card_id ORDER BY cl.position,cl.id LIMIT 1)
WHERE ci.checklist_id IS NULL;
ALTER TABLE checklist_items ALTER COLUMN checklist_id SET NOT NULL;
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS assignee_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS due_date timestamptz;
CREATE INDEX IF NOT EXISTS checklist_items_checklist_position_idx ON checklist_items(checklist_id,position);
CREATE TABLE IF NOT EXISTS custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  type varchar(16) NOT NULL CHECK (type IN ('text','number','date','dropdown','checkbox')),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  position integer NOT NULL DEFAULT 0,
  show_on_card boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS card_custom_values (
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value jsonb NOT NULL,
  PRIMARY KEY(card_id,field_id)
);
CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  kind varchar(8) NOT NULL CHECK (kind IN ('file','url','card','board')),
  name varchar(255) NOT NULL,
  url text,
  target_id uuid,
  mime_type varchar(120),
  size_bytes integer,
  data bytea,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_card_position_idx ON attachments(card_id,position);
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_cover_attachment_id_fkey;
ALTER TABLE cards ADD CONSTRAINT cards_cover_attachment_id_fkey FOREIGN KEY (cover_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS card_assignees (
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, user_id)
);
CREATE TABLE IF NOT EXISTS board_visits (
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visited_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX IF NOT EXISTS board_visits_user_idx ON board_visits(user_id, visited_at DESC);
CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id uuid REFERENCES boards(id) ON DELETE CASCADE,
  card_id uuid REFERENCES cards(id) ON DELETE SET NULL,
  kind varchar(32) NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activities_board_created_idx ON activities(board_id, created_at DESC);
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_id varchar(80) NOT NULL DEFAULT 'cards',
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id uuid REFERENCES boards(id) ON DELETE CASCADE,
  card_id uuid REFERENCES cards(id) ON DELETE CASCADE,
  kind varchar(32) NOT NULL,
  title varchar(300) NOT NULL,
  body text NOT NULL DEFAULT '',
  target_url text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS due_at timestamptz;
DELETE FROM notifications WHERE kind='due' AND due_at IS NULL;
DROP INDEX IF EXISTS notifications_due_once_idx;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_due_occurrence_idx ON notifications(user_id, card_id, kind, due_at) WHERE kind = 'due';
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS focus_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(160) NOT NULL DEFAULT 'Focus time', starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS focus_event_cards (
  event_id uuid NOT NULL REFERENCES focus_events(id) ON DELETE CASCADE, card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  PRIMARY KEY(event_id,card_id)
);
CREATE TABLE IF NOT EXISTS card_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merged_card_id uuid REFERENCES cards(id) ON DELETE SET NULL,
  source_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz
);
CREATE TABLE IF NOT EXISTS planner_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  proactive boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS focus_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(300) NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS focus_block_cards (
  focus_block_id uuid NOT NULL REFERENCES focus_blocks(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  PRIMARY KEY(focus_block_id,card_id)
);
CREATE TABLE IF NOT EXISTS planner_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text NOT NULL DEFAULT '',
  source varchar(24) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (ends_at > starts_at),
  CHECK (status IN ('pending','accepted','rejected'))
);
CREATE INDEX IF NOT EXISTS planner_suggestions_user_status_idx ON planner_suggestions(user_id,status,starts_at);
CREATE TABLE IF NOT EXISTS email_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  sender varchar(255),
  subject varchar(500),
  body text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  local_path text NOT NULL,
  ai_default_model varchar(100),
  ai_default_effort varchar(16) CHECK(ai_default_effort IN ('low','medium','high','xhigh')),
  is_native boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, local_path)
);
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_ai_project_id_fkey;
ALTER TABLE cards ADD CONSTRAINT cards_ai_project_id_fkey FOREIGN KEY (ai_project_id) REFERENCES ai_projects(id) ON DELETE SET NULL;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS ai_default_project_id uuid REFERENCES ai_projects(id) ON DELETE SET NULL;
ALTER TABLE ai_projects ADD COLUMN IF NOT EXISTS is_native boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS card_ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES ai_projects(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model varchar(100) NOT NULL,
  effort varchar(16) NOT NULL DEFAULT 'medium',
  prompt text NOT NULL,
  source varchar(16) NOT NULL DEFAULT 'description' CHECK(source IN ('description','comment')),
  codex_session_id text,
  output text,
  summary text,
  file_changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  activities jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested_commit_type varchar(30),
  suggested_commit_name varchar(100),
  suggested_commit_summary varchar(360),
  status varchar(16) NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','success','error','cancelled')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  worker_id text,
  finished_at timestamptz
);
ALTER TABLE card_ai_runs ADD COLUMN IF NOT EXISTS effort varchar(16) NOT NULL DEFAULT 'medium';
ALTER TABLE card_ai_runs ADD COLUMN IF NOT EXISTS codex_session_id text;
ALTER TABLE card_ai_runs ADD COLUMN IF NOT EXISTS suggested_commit_type varchar(30);
ALTER TABLE card_ai_runs ADD COLUMN IF NOT EXISTS suggested_commit_name varchar(100);
ALTER TABLE card_ai_runs ADD COLUMN IF NOT EXISTS suggested_commit_summary varchar(360);
ALTER TABLE card_ai_runs ALTER COLUMN status SET DEFAULT 'queued';
ALTER TABLE card_ai_runs DROP CONSTRAINT IF EXISTS card_ai_runs_status_check;
ALTER TABLE card_ai_runs ADD CONSTRAINT card_ai_runs_status_check CHECK(status IN ('queued','running','success','error','cancelled'));
CREATE INDEX IF NOT EXISTS card_ai_runs_card_started_idx ON card_ai_runs(card_id, started_at DESC);
CREATE TABLE IF NOT EXISTS card_ai_comment_jobs (
  comment_id uuid PRIMARY KEY REFERENCES comments(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES ai_projects(id) ON DELETE RESTRICT,
  model varchar(100) NOT NULL,
  effort varchar(16) NOT NULL CHECK(effort IN ('low','medium','high','xhigh')),
  status varchar(16) NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','success','error')),
  answer_comment_id uuid REFERENCES comments(id) ON DELETE SET NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS card_ai_comment_jobs_queue_idx ON card_ai_comment_jobs(card_id,status,created_at);
CREATE TABLE IF NOT EXISTS trello_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  trello_board_id varchar(64) NOT NULL,
  trello_board_name varchar(160) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(board_id, trello_board_id)
);
CREATE TABLE IF NOT EXISTS trello_list_mappings (
  connection_id uuid NOT NULL REFERENCES trello_connections(id) ON DELETE CASCADE,
  trello_list_id varchar(64) NOT NULL,
  trello_list_name varchar(160),
  orbit_list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  PRIMARY KEY(connection_id, trello_list_id),
  UNIQUE(connection_id, orbit_list_id)
);
ALTER TABLE trello_list_mappings ADD COLUMN IF NOT EXISTS trello_list_name varchar(160);
CREATE TABLE IF NOT EXISTS trello_card_mappings (
  connection_id uuid NOT NULL REFERENCES trello_connections(id) ON DELETE CASCADE,
  trello_card_id varchar(64) NOT NULL,
  orbit_card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  last_trello_activity timestamptz,
  last_orbit_update timestamptz,
  PRIMARY KEY(connection_id, trello_card_id),
  UNIQUE(connection_id, orbit_card_id)
);
CREATE INDEX IF NOT EXISTS trello_connections_board_idx ON trello_connections(board_id);

CREATE TABLE IF NOT EXISTS saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  query jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_searches_user_updated_idx ON saved_searches(user_id,updated_at DESC);
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
ALTER TABLE ai_projects ADD COLUMN IF NOT EXISTS default_git_repository_id uuid REFERENCES git_repositories(id) ON DELETE SET NULL;

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
  action varchar(12) NOT NULL DEFAULT 'commit' CHECK (action IN ('commit', 'undo', 'redo')),
  target_sha varchar(40),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(card_id,repository_id,sha)
);
ALTER TABLE git_card_commits
  ADD COLUMN IF NOT EXISTS action varchar(12) NOT NULL DEFAULT 'commit',
  ADD COLUMN IF NOT EXISTS target_sha varchar(40);
CREATE INDEX IF NOT EXISTS git_card_commits_card_idx ON git_card_commits(card_id,created_at DESC);
CREATE INDEX IF NOT EXISTS git_card_commits_target_idx ON git_card_commits(card_id,repository_id,target_sha,created_at DESC);

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
ALTER TABLE git_pipeline_targets ADD COLUMN IF NOT EXISTS deployment_method varchar(16) NOT NULL DEFAULT 'provider';
ALTER TABLE git_pipeline_targets DROP CONSTRAINT IF EXISTS git_pipeline_targets_deployment_method_check;
ALTER TABLE git_pipeline_targets ADD CONSTRAINT git_pipeline_targets_deployment_method_check CHECK (deployment_method IN ('provider','ssh','git'));
ALTER TABLE git_pipeline_targets ADD COLUMN IF NOT EXISTS git_flow varchar(24) NOT NULL DEFAULT 'pipeline_only';
ALTER TABLE git_pipeline_targets DROP CONSTRAINT IF EXISTS git_pipeline_targets_git_flow_check;
ALTER TABLE git_pipeline_targets ADD CONSTRAINT git_pipeline_targets_git_flow_check CHECK (git_flow IN ('pipeline_only','commit_push','pull_push'));
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
ALTER TABLE delivery_runs ADD COLUMN IF NOT EXISTS trigger_key uuid;
DROP INDEX IF EXISTS delivery_runs_card_trigger_idx;
CREATE UNIQUE INDEX IF NOT EXISTS delivery_runs_trigger_key_idx ON delivery_runs(pipeline_id,trigger_key) WHERE trigger_key IS NOT NULL;
ALTER TABLE delivery_steps ADD COLUMN IF NOT EXISTS retry_delay_ms integer NOT NULL DEFAULT 0 CHECK (retry_delay_ms BETWEEN 0 AND 60000);

CREATE TABLE IF NOT EXISTS backup_cloud_copies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive text NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider varchar(80) NOT NULL,
  connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL CHECK (status IN ('uploading','success','failed')),
  folder_id text,
  archive_file_id text,
  manifest_file_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(archive,owner_id,provider,connection_id)
);
CREATE INDEX IF NOT EXISTS backup_cloud_copies_owner_archive_idx ON backup_cloud_copies(owner_id,archive);

CREATE TABLE IF NOT EXISTS backup_cloud_settings (
  owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE RESTRICT,
  auto_upload boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vault_backup_cloud_copies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive text NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL CHECK (status IN ('uploading','success','failed')),
  folder_id text,
  archive_file_id text,
  manifest_file_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(archive,owner_id,connection_id)
);
CREATE INDEX IF NOT EXISTS vault_backup_cloud_copies_owner_idx ON vault_backup_cloud_copies(owner_id,created_at DESC);

CREATE TABLE IF NOT EXISTS config_backup_cloud_copies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive text NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL CHECK (status IN ('uploading','success','failed')),
  folder_id text,
  archive_file_id text,
  manifest_file_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(archive,owner_id,connection_id)
);
CREATE INDEX IF NOT EXISTS config_backup_cloud_copies_owner_idx ON config_backup_cloud_copies(owner_id,created_at DESC);

CREATE TABLE IF NOT EXISTS attachment_backup_cloud_copies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive text NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE RESTRICT,
  source_kind varchar(8) NOT NULL CHECK (source_kind IN ('card','comment')),
  source_id uuid NOT NULL,
  card_id uuid NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('uploading','success','failed')),
  folder_id text,
  archive_file_id text,
  manifest_file_id text,
  error text,
  folder_path text,
  organized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(archive,owner_id,connection_id)
);
CREATE INDEX IF NOT EXISTS attachment_backup_cloud_copies_owner_idx ON attachment_backup_cloud_copies(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS attachment_backup_cloud_copies_source_idx ON attachment_backup_cloud_copies(owner_id,connection_id,source_kind,source_id,status);

CREATE TABLE IF NOT EXISTS vault_backup_restores (
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sha256 char(64) NOT NULL,
  item_count integer NOT NULL,
  restored_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,sha256)
);
