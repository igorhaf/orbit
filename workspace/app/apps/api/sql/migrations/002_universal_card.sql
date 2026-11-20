ALTER TABLE cards ADD COLUMN IF NOT EXISTS schedule_start_at timestamptz;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS schedule_end_at timestamptz;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS schedule_all_day boolean NOT NULL DEFAULT false;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS schedule_time_zone varchar(100);

CREATE TABLE IF NOT EXISTS integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plugin_id varchar(100) NOT NULL,
  provider_connection_id text,
  label varchar(200) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}',
  secrets_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,plugin_id,provider_connection_id)
);
CREATE INDEX IF NOT EXISTS integration_connections_owner_plugin_idx
  ON integration_connections(owner_id,plugin_id);

CREATE TABLE IF NOT EXISTS external_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plugin_id varchar(100) NOT NULL,
  connection_id uuid REFERENCES integration_connections(id) ON DELETE CASCADE,
  resource_type varchar(100) NOT NULL,
  external_id text NOT NULL,
  external_parent_id text,
  url text,
  etag text,
  orbit_entity_type varchar(100),
  orbit_entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS external_resources_identity_idx
  ON external_resources(owner_id,plugin_id,connection_id,resource_type,external_id)
  NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS external_resources_orbit_entity_idx
  ON external_resources(owner_id,orbit_entity_type,orbit_entity_id);

CREATE TABLE IF NOT EXISTS card_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  run_id uuid REFERENCES card_runs(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  type varchar(100) NOT NULL,
  label varchar(300),
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,position)
);
CREATE INDEX IF NOT EXISTS card_outputs_card_created_idx
  ON card_outputs(card_id,created_at DESC);
