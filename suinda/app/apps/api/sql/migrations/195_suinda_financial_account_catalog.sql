CREATE TABLE IF NOT EXISTS suinda_financial_account_catalog_imports (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  csv_sha256 text NOT NULL CHECK (csv_sha256 ~ '^[0-9a-f]{64}$'),
  row_count integer NOT NULL CHECK (row_count BETWEEN 1 AND 5000),
  imported_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,csv_sha256),
  UNIQUE(workspace_id,id)
);

CREATE TABLE IF NOT EXISTS suinda_financial_account_catalog (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  account_code text NOT NULL CHECK (account_code ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
  account_name text NOT NULL CHECK (length(account_name) BETWEEN 1 AND 200),
  account_type text NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','expense','other')),
  parent_code text NULL,
  active boolean NOT NULL DEFAULT true,
  import_id uuid NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,account_code),
  FOREIGN KEY(workspace_id,import_id) REFERENCES suinda_financial_account_catalog_imports(workspace_id,id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS suinda_financial_account_catalog_workspace_name_idx
  ON suinda_financial_account_catalog(workspace_id,active,account_name,account_code);

CREATE OR REPLACE FUNCTION prevent_suinda_financial_account_catalog_import_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Suindá account catalog import history is append-only'; END;
$$;

DROP TRIGGER IF EXISTS suinda_financial_account_catalog_import_immutable ON suinda_financial_account_catalog_imports;
CREATE TRIGGER suinda_financial_account_catalog_import_immutable
  BEFORE UPDATE OR DELETE ON suinda_financial_account_catalog_imports
  FOR EACH ROW EXECUTE FUNCTION prevent_suinda_financial_account_catalog_import_mutation();
