CREATE TABLE gastro_finance_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('receivable', 'payable')),
  category text NOT NULL CHECK (category IN ('service', 'supplies', 'facility', 'staff', 'utilities', 'other')),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 99999999999999),
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  due_on date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'void')),
  operation_key uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gastro_finance_entry_operation_unique UNIQUE (workspace_id, operation_key)
);

CREATE INDEX gastro_finance_entries_workspace_history
  ON gastro_finance_entries(workspace_id, created_at DESC, id DESC);
CREATE INDEX gastro_finance_entries_due
  ON gastro_finance_entries(workspace_id, due_on, id) WHERE status = 'open';

CREATE TABLE gastro_finance_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  entry_id uuid NOT NULL REFERENCES gastro_finance_entries(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('settlement', 'reversal')),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 99999999999999),
  method text NOT NULL CHECK (method IN ('cash', 'pix', 'bank_transfer', 'card', 'other')),
  operation_key uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  reverses_id uuid REFERENCES gastro_finance_movements(id) ON DELETE RESTRICT,
  reversal_reason text CHECK (reversal_reason IS NULL OR reversal_reason IN ('duplicate', 'entered_in_error', 'refund', 'other')),
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gastro_finance_movement_operation_unique UNIQUE (workspace_id, operation_key),
  CONSTRAINT gastro_finance_reversal_shape CHECK (
    (movement_type = 'settlement' AND reverses_id IS NULL AND reversal_reason IS NULL)
    OR (movement_type = 'reversal' AND reverses_id IS NOT NULL AND reversal_reason IS NOT NULL)
  ),
  CONSTRAINT gastro_finance_reversal_unique UNIQUE (reverses_id)
);

CREATE INDEX gastro_finance_movements_entry_history
  ON gastro_finance_movements(entry_id, created_at, id);
CREATE INDEX gastro_finance_movements_workspace_history
  ON gastro_finance_movements(workspace_id, created_at DESC, id DESC);

CREATE FUNCTION gastro_finance_entries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'gastro finance entries are retained' USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.direction IS DISTINCT FROM OLD.direction
    OR NEW.category IS DISTINCT FROM OLD.category
    OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.due_on IS DISTINCT FROM OLD.due_on
    OR NEW.operation_key IS DISTINCT FROM OLD.operation_key
    OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR OLD.status <> 'open' OR NEW.status <> 'void' THEN
    RAISE EXCEPTION 'gastro finance entry edits are prohibited' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM gastro_finance_movements WHERE entry_id = OLD.id) THEN
    RAISE EXCEPTION 'entries with movement history cannot be voided' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER gastro_finance_entries_no_edit_or_delete
  BEFORE UPDATE OR DELETE ON gastro_finance_entries
  FOR EACH ROW EXECUTE FUNCTION gastro_finance_entries_guard();

CREATE FUNCTION gastro_finance_movements_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  entry_row gastro_finance_entries%ROWTYPE;
  original_row gastro_finance_movements%ROWTYPE;
  settled bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'gastro finance movement history is append-only' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO entry_row FROM gastro_finance_entries
    WHERE id = NEW.entry_id AND workspace_id = NEW.workspace_id FOR UPDATE;
  IF NOT FOUND OR entry_row.status <> 'open' THEN
    RAISE EXCEPTION 'finance entry is unavailable' USING ERRCODE = '23514';
  END IF;
  IF NEW.movement_type = 'settlement' THEN
    SELECT COALESCE(SUM(CASE WHEN movement_type = 'settlement' THEN amount_minor ELSE -amount_minor END), 0)
      INTO settled FROM gastro_finance_movements WHERE entry_id = NEW.entry_id;
    IF NEW.amount_minor > entry_row.amount_minor - settled THEN
      RAISE EXCEPTION 'settlement exceeds open balance' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO original_row FROM gastro_finance_movements
      WHERE id = NEW.reverses_id AND entry_id = NEW.entry_id AND workspace_id = NEW.workspace_id
        AND movement_type = 'settlement' FOR UPDATE;
    IF NOT FOUND OR original_row.amount_minor <> NEW.amount_minor OR original_row.method <> NEW.method
      OR EXISTS (SELECT 1 FROM gastro_finance_movements WHERE reverses_id = original_row.id) THEN
      RAISE EXCEPTION 'invalid or already reversed settlement' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER gastro_finance_movements_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON gastro_finance_movements
  FOR EACH ROW EXECUTE FUNCTION gastro_finance_movements_guard();
