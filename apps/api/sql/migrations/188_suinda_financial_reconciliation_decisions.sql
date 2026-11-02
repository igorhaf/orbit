CREATE TABLE IF NOT EXISTS suinda_financial_statement_resolution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  import_id uuid NOT NULL,
  row_number integer NOT NULL,
  selected_payment_entry_id uuid NOT NULL,
  operation_key uuid NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN ('reference_confirmed','provider_receipt_reviewed','institutional_review')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (import_id,row_number) REFERENCES suinda_financial_statement_rows(import_id,row_number) ON DELETE RESTRICT,
  FOREIGN KEY (selected_payment_entry_id,workspace_id) REFERENCES extension_records(id,workspace_id) ON DELETE RESTRICT,
  UNIQUE (workspace_id,operation_key)
);
CREATE INDEX IF NOT EXISTS suinda_financial_statement_resolution_current_idx
  ON suinda_financial_statement_resolution_events(import_id,row_number,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS suinda_financial_statement_resolution_payment_idx
  ON suinda_financial_statement_resolution_events(import_id,selected_payment_entry_id,created_at DESC);

CREATE OR REPLACE FUNCTION prevent_suinda_financial_statement_resolution_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Suindá reconciliation decisions are append-only'; END;
$$;
DROP TRIGGER IF EXISTS suinda_financial_statement_resolution_immutable ON suinda_financial_statement_resolution_events;
CREATE TRIGGER suinda_financial_statement_resolution_immutable
  BEFORE UPDATE OR DELETE ON suinda_financial_statement_resolution_events FOR EACH ROW EXECUTE FUNCTION prevent_suinda_financial_statement_resolution_mutation();
