ALTER TABLE cards ADD COLUMN IF NOT EXISTS schedule_start_at timestamptz;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS schedule_end_at timestamptz;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS schedule_all_day boolean NOT NULL DEFAULT false;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS schedule_time_zone varchar(100);

CREATE TABLE IF NOT EXISTS integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plugin_id varchar(80) NOT NULL,
  external_account_id varchar(500),
  display_name varchar(255) NOT NULL,
  credentials_encrypted text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,plugin_id,external_account_id)
);

CREATE TABLE IF NOT EXISTS external_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plugin_id varchar(80) NOT NULL,
  connection_id uuid REFERENCES integration_connections(id) ON DELETE CASCADE,
  resource_type varchar(80) NOT NULL,
  external_id varchar(1000) NOT NULL,
  external_parent_id varchar(1000),
  url text,
  etag text,
  orbit_entity_type varchar(80),
  orbit_entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,plugin_id,connection_id,resource_type,external_id)
);
CREATE INDEX IF NOT EXISTS external_resources_orbit_idx ON external_resources(owner_id,orbit_entity_type,orbit_entity_id);

CREATE TABLE IF NOT EXISTS calendar_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id varchar(80) NOT NULL,
  connection_id uuid REFERENCES integration_connections(id) ON DELETE CASCADE,
  external_id varchar(1000) NOT NULL,
  name varchar(255) NOT NULL,
  time_zone varchar(100),
  color varchar(32),
  access_role varchar(32),
  is_primary boolean NOT NULL DEFAULT false,
  selected boolean NOT NULL DEFAULT false,
  visible boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,provider_id,connection_id,external_id)
);
CREATE INDEX IF NOT EXISTS calendar_sources_owner_idx ON calendar_sources(owner_id,visible,selected);

CREATE TABLE IF NOT EXISTS calendar_source_settings (
  source_id uuid PRIMARY KEY REFERENCES calendar_sources(id) ON DELETE CASCADE,
  auto_create_cards boolean NOT NULL DEFAULT false,
  target_board_id uuid REFERENCES boards(id) ON DELETE SET NULL,
  target_list_id uuid REFERENCES lists(id) ON DELETE SET NULL,
  update_linked_cards boolean NOT NULL DEFAULT false,
  archive_cancelled_cards boolean NOT NULL DEFAULT false,
  recurring_strategy varchar(32) NOT NULL DEFAULT 'series' CHECK(recurring_strategy IN ('series','occurrence')),
  field_mapping jsonb NOT NULL DEFAULT '{"title":true,"description":true}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendar_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE,
  resource_type varchar(16) NOT NULL CHECK(resource_type IN ('event','card')),
  external_resource_id uuid REFERENCES external_resources(id) ON DELETE SET NULL,
  card_id uuid REFERENCES cards(id) ON DELETE CASCADE,
  external_id varchar(1000),
  title varchar(500) NOT NULL,
  description text,
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  time_zone varchar(100),
  location text,
  recurrence jsonb NOT NULL DEFAULT '[]'::jsonb,
  attendees jsonb NOT NULL DEFAULT '[]'::jsonb,
  conference jsonb,
  status varchar(32) NOT NULL DEFAULT 'confirmed',
  external_url text,
  etag text,
  series_external_id varchar(1000),
  occurrence_external_id varchar(1000),
  provider_updated_at timestamptz,
  operation_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id,external_id)
);
CREATE INDEX IF NOT EXISTS calendar_items_range_idx ON calendar_items(owner_id,start_at,end_at);
CREATE INDEX IF NOT EXISTS calendar_items_card_idx ON calendar_items(card_id) WHERE card_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS calendar_sync_states (
  source_id uuid PRIMARY KEY REFERENCES calendar_sources(id) ON DELETE CASCADE,
  cursor text,
  status varchar(24) NOT NULL DEFAULT 'idle',
  last_error text,
  last_synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendar_watch_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE,
  provider_channel_id varchar(255) NOT NULL UNIQUE,
  provider_resource_id varchar(1000),
  secret_encrypted text NOT NULL,
  expires_at timestamptz NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calendar_watch_renew_idx ON calendar_watch_channels(status,expires_at);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash varchar(64) PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plugin_id varchar(80) NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
