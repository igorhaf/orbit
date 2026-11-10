CREATE TABLE IF NOT EXISTS suinda_erp_integrations (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  endpoint text NOT NULL CHECK (length(endpoint) BETWEEN 1 AND 2048),
  token_encrypted text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suinda_erp_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  unit_record_id uuid NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  entry_count integer NOT NULL CHECK (entry_count BETWEEN 0 AND 50000),
  payload text NOT NULL CHECK (jsonb_typeof(payload::jsonb)='object'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','delivered','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  remote_status integer NULL CHECK (remote_status BETWEEN 100 AND 599),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NULL,
  delivered_at timestamptz NULL,
  FOREIGN KEY(workspace_id,unit_record_id) REFERENCES extension_records(workspace_id,id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS suinda_erp_batches_workspace_created_idx
  ON suinda_erp_batches(workspace_id,created_at DESC);

CREATE OR REPLACE FUNCTION prevent_suinda_erp_batch_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
    OR OLD.unit_record_id IS DISTINCT FROM NEW.unit_record_id OR OLD.period_from IS DISTINCT FROM NEW.period_from
    OR OLD.period_to IS DISTINCT FROM NEW.period_to OR OLD.entry_count IS DISTINCT FROM NEW.entry_count
    OR OLD.payload IS DISTINCT FROM NEW.payload OR OLD.payload_sha256 IS DISTINCT FROM NEW.payload_sha256
    OR OLD.created_by IS DISTINCT FROM NEW.created_by OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Suindá ERP batch payload is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS suinda_erp_batch_immutable ON suinda_erp_batches;
CREATE TRIGGER suinda_erp_batch_immutable BEFORE UPDATE ON suinda_erp_batches
  FOR EACH ROW EXECUTE FUNCTION prevent_suinda_erp_batch_mutation();
