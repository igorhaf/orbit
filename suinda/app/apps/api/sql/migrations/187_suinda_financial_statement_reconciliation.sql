CREATE TABLE IF NOT EXISTS suinda_financial_statement_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  unit_record_id uuid,
  operation_key uuid NOT NULL,
  csv_sha256 text NOT NULL CHECK (csv_sha256 ~ '^[a-f0-9]{64}$'),
  row_count integer NOT NULL CHECK (row_count BETWEEN 1 AND 1000),
  matched_count integer NOT NULL CHECK (matched_count >= 0),
  ambiguous_count integer NOT NULL CHECK (ambiguous_count >= 0),
  unmatched_count integer NOT NULL CHECK (unmatched_count >= 0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,id),
  UNIQUE (workspace_id,operation_key),
  FOREIGN KEY (unit_record_id,workspace_id) REFERENCES extension_records(id,workspace_id) ON DELETE RESTRICT,
  CHECK (matched_count + ambiguous_count + unmatched_count = row_count)
);
CREATE INDEX IF NOT EXISTS suinda_financial_statement_imports_workspace_idx
  ON suinda_financial_statement_imports(workspace_id,created_at DESC);

CREATE TABLE IF NOT EXISTS suinda_financial_statement_rows (
  import_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  row_number integer NOT NULL CHECK (row_number >= 2),
  match_status text NOT NULL CHECK (match_status IN ('matched','ambiguous','unmatched')),
  matched_payment_entry_id uuid,
  candidate_payment_entry_ids uuid[] NOT NULL DEFAULT '{}',
  PRIMARY KEY(import_id,row_number),
  FOREIGN KEY (import_id,workspace_id) REFERENCES suinda_financial_statement_imports(id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (matched_payment_entry_id,workspace_id) REFERENCES extension_records(id,workspace_id) ON DELETE RESTRICT,
  CHECK (
    (match_status='matched' AND matched_payment_entry_id IS NOT NULL AND cardinality(candidate_payment_entry_ids)=1)
    OR (match_status='ambiguous' AND matched_payment_entry_id IS NULL AND cardinality(candidate_payment_entry_ids)>1)
    OR (match_status='unmatched' AND matched_payment_entry_id IS NULL AND cardinality(candidate_payment_entry_ids)=0)
  )
);
CREATE INDEX IF NOT EXISTS suinda_financial_statement_rows_workspace_match_idx
  ON suinda_financial_statement_rows(workspace_id,match_status,import_id);

CREATE OR REPLACE FUNCTION prevent_suinda_financial_statement_import_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Suindá reconciliation imports are immutable'; END;
$$;
DROP TRIGGER IF EXISTS suinda_financial_statement_import_immutable ON suinda_financial_statement_imports;
CREATE TRIGGER suinda_financial_statement_import_immutable
  BEFORE UPDATE OR DELETE ON suinda_financial_statement_imports FOR EACH ROW EXECUTE FUNCTION prevent_suinda_financial_statement_import_mutation();
DROP TRIGGER IF EXISTS suinda_financial_statement_row_immutable ON suinda_financial_statement_rows;
CREATE TRIGGER suinda_financial_statement_row_immutable
  BEFORE UPDATE OR DELETE ON suinda_financial_statement_rows FOR EACH ROW EXECUTE FUNCTION prevent_suinda_financial_statement_import_mutation();
