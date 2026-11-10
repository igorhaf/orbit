CREATE TABLE IF NOT EXISTS suinda_financial_account_mappings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE RESTRICT,
  mappings jsonb NOT NULL CHECK (jsonb_typeof(mappings) = 'object'),
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);
