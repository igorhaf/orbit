CREATE TABLE IF NOT EXISTS suinda_whatsapp_config (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  credentials_encrypted text NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suinda_whatsapp_consents (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_e164 varchar(16) NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  opted_in boolean NOT NULL DEFAULT false,
  categories text[] NOT NULL DEFAULT '{}',
  consented_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,user_id),
  CHECK (opted_in = (consented_at IS NOT NULL AND revoked_at IS NULL))
);

CREATE TABLE IF NOT EXISTS suinda_whatsapp_deliveries (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  idempotency_key varchar(100) NOT NULL,
  request_hash char(64) NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  category varchar(40) NOT NULL,
  state varchar(16) NOT NULL CHECK (state IN ('sending','sent','failed')),
  provider_message_id varchar(160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS suinda_whatsapp_deliveries_user_idx
  ON suinda_whatsapp_deliveries(workspace_id,user_id,created_at DESC);
