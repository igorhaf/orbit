CREATE UNIQUE INDEX IF NOT EXISTS suinda_staff_honorarium_identity_currency_uidx
  ON suinda_staff_honorarium_ledger(workspace_id,id,staff_user_id,currency);

CREATE TABLE IF NOT EXISTS suinda_staff_honorarium_payments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  honorarium_id uuid NOT NULL,
  staff_user_id uuid NOT NULL,
  paid_on date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reference text CHECK (reference IS NULL OR length(reference) <= 200),
  notes text CHECK (notes IS NULL OR length(notes) <= 1000),
  operation_key uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,operation_key),
  FOREIGN KEY (workspace_id,honorarium_id,staff_user_id,currency)
    REFERENCES suinda_staff_honorarium_ledger(workspace_id,id,staff_user_id,currency) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS suinda_staff_honorarium_payments_history_idx
  ON suinda_staff_honorarium_payments(workspace_id,honorarium_id,paid_on,created_at,id);

CREATE OR REPLACE FUNCTION suinda_staff_honorarium_payment_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Suindá honorarium payment ledger is immutable; record a separate correction';
END;
$$;
DROP TRIGGER IF EXISTS suinda_staff_honorarium_payment_immutable ON suinda_staff_honorarium_payments;
CREATE TRIGGER suinda_staff_honorarium_payment_immutable BEFORE UPDATE OR DELETE ON suinda_staff_honorarium_payments
  FOR EACH ROW EXECUTE FUNCTION suinda_staff_honorarium_payment_immutable();
