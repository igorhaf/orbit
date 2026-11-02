CREATE TABLE IF NOT EXISTS suinda_certificate_signing_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  p12_encrypted text NOT NULL,
  certificate_subject text NOT NULL,
  certificate_serial text NOT NULL,
  certificate_fingerprint text NOT NULL CHECK (certificate_fingerprint ~ '^[0-9a-f]{64}$'),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL CHECK (valid_until > valid_from),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS suinda_certificate_signing_expiry_idx
  ON suinda_certificate_signing_settings(valid_until);
