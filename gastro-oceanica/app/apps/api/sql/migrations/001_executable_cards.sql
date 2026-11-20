CREATE TABLE card_execution_configs (
  card_id uuid PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  project_id uuid REFERENCES ai_projects(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  agent text,
  executor text,
  action text,
  skills text[] NOT NULL DEFAULT '{}',
  working_directory text NOT NULL DEFAULT '.',
  mode text NOT NULL DEFAULT 'manual' CHECK(mode IN ('manual','automatic')),
  permissions text[] NOT NULL DEFAULT '{}',
  context jsonb NOT NULL DEFAULT '{}',
  integrations jsonb NOT NULL DEFAULT '[]',
  automation jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE card_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  project_id uuid REFERENCES ai_projects(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent text,
  executor text NOT NULL,
  action text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','success','failed','cancelled')),
  stage text NOT NULL DEFAULT 'queued',
  input jsonb NOT NULL,
  output jsonb,
  error text,
  request_key text NOT NULL,
  chain uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false,
  UNIQUE(card_id,request_key)
);
CREATE UNIQUE INDEX card_runs_one_active ON card_runs(card_id) WHERE status IN ('queued','running');
CREATE INDEX card_runs_history ON card_runs(card_id,created_at DESC);
CREATE INDEX card_runs_queue ON card_runs(created_at) WHERE status='queued';
CREATE TABLE card_run_logs (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES card_runs(id) ON DELETE CASCADE,
  stage text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX card_run_logs_run ON card_run_logs(run_id,id);
