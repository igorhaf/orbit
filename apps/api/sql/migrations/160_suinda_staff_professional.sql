CREATE TABLE IF NOT EXISTS suinda_staff_honorarium_ledger (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  staff_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency ~ '^[A-Z]{3}$'),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 1000),
  operation_key uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_start <= period_end),
  UNIQUE(workspace_id,operation_key)
);
CREATE INDEX IF NOT EXISTS suinda_staff_honorarium_staff_period
  ON suinda_staff_honorarium_ledger(workspace_id,staff_user_id,period_end DESC,created_at DESC);
CREATE OR REPLACE FUNCTION suinda_staff_honorarium_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Suindá honorarium ledger is immutable; record a separate adjustment';
END;
$$;
DROP TRIGGER IF EXISTS suinda_staff_honorarium_immutable ON suinda_staff_honorarium_ledger;
CREATE TRIGGER suinda_staff_honorarium_immutable BEFORE UPDATE OR DELETE ON suinda_staff_honorarium_ledger
  FOR EACH ROW EXECUTE FUNCTION suinda_staff_honorarium_immutable();
