CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  endpoint text NOT NULL CHECK (length(endpoint) BETWEEN 1 AND 2048),
  event_types text[] NOT NULL CHECK (cardinality(event_types)>0 AND event_types <@ ARRAY['record.created','record.updated']::text[]),
  secret_ciphertext text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_subscriptions_workspace_idx ON webhook_subscriptions(workspace_id,created_at DESC);
CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  record_id uuid NOT NULL,
  plugin_id varchar(100) NOT NULL,
  kind varchar(100) NOT NULL,
  state varchar(100) NOT NULL,
  revision integer NOT NULL CHECK (revision>0),
  event_type text NOT NULL CHECK(event_type IN ('record.created','record.updated')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,record_id,revision,event_type)
);
CREATE INDEX IF NOT EXISTS webhook_events_workspace_idx ON webhook_events(workspace_id,occurred_at DESC);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES webhook_events(id) ON DELETE CASCADE,
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','delivered','dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 8),
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error varchar(40),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscription_id,event_id)
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_pending_idx ON webhook_deliveries(available_at,created_at) WHERE status IN ('pending','sending');
