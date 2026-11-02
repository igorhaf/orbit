CREATE TABLE IF NOT EXISTS suinda_open_badge_issuers (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  issuer_name varchar(160) NOT NULL CHECK (length(btrim(issuer_name)) BETWEEN 1 AND 160),
  private_key_encrypted text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suinda_open_badge_credential_refs (
  certificate_id uuid PRIMARY KEY REFERENCES extension_records(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  credential_id uuid NOT NULL UNIQUE,
  identity_salt text NOT NULL CHECK (identity_salt ~ '^[a-f0-9]{32}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(certificate_id,workspace_id) REFERENCES extension_records(id,workspace_id) ON DELETE RESTRICT
);
