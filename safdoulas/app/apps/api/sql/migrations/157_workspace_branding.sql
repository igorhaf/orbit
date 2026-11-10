CREATE TABLE IF NOT EXISTS workspace_branding (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  public_name varchar(100),
  logo_url varchar(2048),
  primary_color varchar(7) NOT NULL DEFAULT '#2563eb',
  accent_color varchar(7) NOT NULL DEFAULT '#38bdf8',
  custom_domain varchar(253),
  domain_verification_token varchar(64),
  domain_verified_at timestamptz,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_branding_primary_color_hex CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT workspace_branding_accent_color_hex CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT workspace_branding_domain_state CHECK (
    (custom_domain IS NULL AND domain_verification_token IS NULL AND domain_verified_at IS NULL)
    OR (custom_domain IS NOT NULL AND domain_verification_token IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_branding_custom_domain_unique
  ON workspace_branding(custom_domain) WHERE custom_domain IS NOT NULL;
