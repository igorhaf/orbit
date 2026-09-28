ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS secret_encrypted text;
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE calendar_sync_states ADD COLUMN IF NOT EXISTS window_start timestamptz;
ALTER TABLE calendar_sync_states ADD COLUMN IF NOT EXISTS window_end timestamptz;
ALTER TABLE calendar_sync_states ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS external_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id varchar(80) NOT NULL,
  connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  source_id uuid REFERENCES calendar_sources(id) ON DELETE CASCADE,
  external_id varchar(1000) NOT NULL,
  resource text NOT NULL,
  change_types varchar(255) NOT NULL,
  secret_encrypted text NOT NULL,
  expires_at timestamptz NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'active',
  last_notification_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_id, external_id)
);
CREATE INDEX IF NOT EXISTS external_subscriptions_renew_idx ON external_subscriptions(provider_id,status,expires_at);
CREATE INDEX IF NOT EXISTS external_subscriptions_source_idx ON external_subscriptions(source_id) WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS external_notification_receipts (
  provider_id varchar(80) NOT NULL,
  fingerprint varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider_id,fingerprint)
);
CREATE INDEX IF NOT EXISTS external_notification_receipts_expiry_idx ON external_notification_receipts(expires_at);
