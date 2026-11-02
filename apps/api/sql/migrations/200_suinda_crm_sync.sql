CREATE TABLE IF NOT EXISTS suinda_crm_integrations (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  endpoint text NOT NULL CHECK (length(endpoint) BETWEEN 1 AND 2048),
  token_encrypted text NOT NULL,
  contact_salt_encrypted text NOT NULL,
  include_phone boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT false,
  deleting boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suinda_crm_contacts (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  learner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,learner_user_id),
  UNIQUE(workspace_id,contact_id)
);

CREATE TABLE IF NOT EXISTS suinda_crm_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('upsert','delete')),
  payload_encrypted text NULL,
  payload_sha256 text NULL CHECK(payload_sha256 IS NULL OR payload_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','delivered','cancelled','dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 8),
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text NULL CHECK(last_error IS NULL OR last_error ~ '^[A-Z0-9_-]{1,40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((action='upsert' AND payload_encrypted IS NOT NULL AND payload_sha256 IS NOT NULL)
     OR (action='delete' AND payload_encrypted IS NULL AND payload_sha256 IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS suinda_crm_upsert_dedupe_idx
  ON suinda_crm_outbox(workspace_id,contact_id,payload_sha256) WHERE action='upsert';
CREATE UNIQUE INDEX IF NOT EXISTS suinda_crm_pending_delete_idx
  ON suinda_crm_outbox(workspace_id,contact_id) WHERE action='delete' AND status IN ('pending','sending');
CREATE INDEX IF NOT EXISTS suinda_crm_outbox_due_idx
  ON suinda_crm_outbox(available_at,created_at) WHERE status='pending';

CREATE OR REPLACE FUNCTION protect_suinda_crm_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
    OR OLD.contact_id IS DISTINCT FROM NEW.contact_id OR OLD.action IS DISTINCT FROM NEW.action
    OR OLD.payload_sha256 IS DISTINCT FROM NEW.payload_sha256 OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Suindá CRM outbox event is immutable';
  END IF;
  IF OLD.payload_encrypted IS DISTINCT FROM NEW.payload_encrypted
    AND NOT (OLD.payload_encrypted IS NOT NULL AND NEW.payload_encrypted IS NULL
      AND NEW.status IN ('delivered','cancelled','dead_letter')) THEN
    RAISE EXCEPTION 'Suindá CRM outbox payload is immutable until terminal redaction';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS suinda_crm_outbox_immutable ON suinda_crm_outbox;
CREATE TRIGGER suinda_crm_outbox_immutable BEFORE UPDATE ON suinda_crm_outbox
  FOR EACH ROW EXECUTE FUNCTION protect_suinda_crm_outbox();
