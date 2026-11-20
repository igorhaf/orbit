-- Plugin-only metadata. No lifecycle operation removes Orbit content.
CREATE TABLE IF NOT EXISTS alexa_exports (
  account_id uuid PRIMARY KEY REFERENCES integration_connections(id) ON DELETE CASCADE,
  query_id uuid UNIQUE,
  query_started_at timestamptz,
  query_status text,
  snapshot_encrypted text,
  snapshot_version uuid,
  fetched_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS alexa_column_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  column_id uuid NOT NULL UNIQUE REFERENCES lists(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES integration_connections(id),
  external_list_key text NOT NULL,
  external_list_id text,
  external_list_name text NOT NULL,
  list_type text NOT NULL,
  direction text NOT NULL DEFAULT 'alexa_to_orbit' CHECK(direction='alexa_to_orbit'),
  enabled boolean NOT NULL DEFAULT true,
  auto_sync boolean NOT NULL DEFAULT false,
  interval_minutes integer NOT NULL DEFAULT 15 CHECK(interval_minutes BETWEEN 15 AND 1440),
  initialized boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'NEVER_SYNCED' CHECK(status IN ('NEVER_SYNCED','SYNCING','SYNCED','PARTIAL','ERROR','AUTH_REQUIRED','REMOTE_ARCHIVED')),
  last_sync_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS alexa_card_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_id uuid NOT NULL REFERENCES alexa_column_bindings(id) ON DELETE CASCADE,
  card_id uuid REFERENCES cards(id) ON DELETE SET NULL,
  checklist_item_id uuid REFERENCES checklist_items(id) ON DELETE SET NULL,
  external_item_key text NOT NULL,
  external_item_id text,
  identity_kind text NOT NULL,
  baseline_encrypted text NOT NULL,
  remote_encrypted text,
  remote_fingerprint text,
  status text NOT NULL DEFAULT 'SYNCED',
  ignored boolean NOT NULL DEFAULT false,
  last_sync_at timestamptz,
  UNIQUE(binding_id,external_item_key)
);
CREATE INDEX IF NOT EXISTS alexa_card_bindings_card_idx ON alexa_card_bindings(card_id);
CREATE TABLE IF NOT EXISTS alexa_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_id uuid NOT NULL REFERENCES alexa_column_bindings(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id),
  snapshot_version uuid NOT NULL,
  local_fingerprint text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes'
);
