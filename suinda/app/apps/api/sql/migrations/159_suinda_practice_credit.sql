CREATE TABLE IF NOT EXISTS suinda_practice_credit_policies (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  enabled boolean NOT NULL DEFAULT false,
  eligible_course_pairs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(eligible_course_pairs)='array'),
  max_hours_per_target numeric(8,2) NOT NULL CHECK (max_hours_per_target > 0 AND max_hours_per_target <= 10000),
  validity_days integer NOT NULL CHECK (validity_days BETWEEN 1 AND 3650),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,version)
);

CREATE INDEX IF NOT EXISTS suinda_practice_credit_policy_latest
  ON suinda_practice_credit_policies(workspace_id,version DESC);

CREATE TABLE IF NOT EXISTS suinda_practice_credit_requests (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  learner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_enrollment_id uuid NOT NULL,
  source_course_revision integer NOT NULL CHECK (source_course_revision > 0),
  target_enrollment_id uuid NOT NULL,
  target_course_revision integer NOT NULL CHECK (target_course_revision > 0),
  requested_hours numeric(8,2) NOT NULL CHECK (requested_hours > 0),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  status text NOT NULL CHECK (status IN ('pending','approved','rejected')) DEFAULT 'pending',
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_enrollment_id <> target_enrollment_id),
  FOREIGN KEY (workspace_id,policy_version) REFERENCES suinda_practice_credit_policies(workspace_id,version)
);

CREATE INDEX IF NOT EXISTS suinda_practice_credit_requests_learner
  ON suinda_practice_credit_requests(learner_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS suinda_practice_credit_requests_pending
  ON suinda_practice_credit_requests(workspace_id,created_at) WHERE status='pending';

CREATE TABLE IF NOT EXISTS suinda_practice_credit_ledger (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES suinda_practice_credit_requests(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  learner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  practice_record_id uuid NOT NULL,
  source_enrollment_id uuid NOT NULL,
  source_course_revision integer NOT NULL CHECK (source_course_revision > 0),
  target_enrollment_id uuid NOT NULL,
  target_course_revision integer NOT NULL CHECK (target_course_revision > 0),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  hours_credited numeric(8,2) NOT NULL CHECK (hours_credited > 0),
  credited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  credited_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id,practice_record_id),
  FOREIGN KEY (workspace_id,policy_version) REFERENCES suinda_practice_credit_policies(workspace_id,version)
);

CREATE INDEX IF NOT EXISTS suinda_practice_credit_ledger_source
  ON suinda_practice_credit_ledger(practice_record_id);
CREATE INDEX IF NOT EXISTS suinda_practice_credit_ledger_target
  ON suinda_practice_credit_ledger(target_enrollment_id);

CREATE TABLE IF NOT EXISTS suinda_practice_credit_events (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES suinda_practice_credit_requests(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('requested','approved','rejected')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION suinda_practice_credit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Suindá practice credit audit data is immutable';
END;
$$;

DROP TRIGGER IF EXISTS suinda_practice_credit_policy_immutable ON suinda_practice_credit_policies;
CREATE TRIGGER suinda_practice_credit_policy_immutable BEFORE UPDATE OR DELETE ON suinda_practice_credit_policies
  FOR EACH ROW EXECUTE FUNCTION suinda_practice_credit_immutable();
DROP TRIGGER IF EXISTS suinda_practice_credit_ledger_immutable ON suinda_practice_credit_ledger;
CREATE TRIGGER suinda_practice_credit_ledger_immutable BEFORE UPDATE OR DELETE ON suinda_practice_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION suinda_practice_credit_immutable();
DROP TRIGGER IF EXISTS suinda_practice_credit_event_immutable ON suinda_practice_credit_events;
CREATE TRIGGER suinda_practice_credit_event_immutable BEFORE UPDATE OR DELETE ON suinda_practice_credit_events
  FOR EACH ROW EXECUTE FUNCTION suinda_practice_credit_immutable();

CREATE OR REPLACE FUNCTION suinda_practice_credit_request_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status<>'pending' OR NEW.status NOT IN ('approved','rejected')
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.learner_user_id IS DISTINCT FROM OLD.learner_user_id
    OR NEW.source_enrollment_id IS DISTINCT FROM OLD.source_enrollment_id
    OR NEW.source_course_revision IS DISTINCT FROM OLD.source_course_revision
    OR NEW.target_enrollment_id IS DISTINCT FROM OLD.target_enrollment_id
    OR NEW.target_course_revision IS DISTINCT FROM OLD.target_course_revision
    OR NEW.requested_hours IS DISTINCT FROM OLD.requested_hours OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Suindá practice credit request audit data is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS suinda_practice_credit_request_transition ON suinda_practice_credit_requests;
CREATE TRIGGER suinda_practice_credit_request_transition BEFORE UPDATE OR DELETE ON suinda_practice_credit_requests
  FOR EACH ROW EXECUTE FUNCTION suinda_practice_credit_request_transition();

DO $$ BEGIN
  IF to_regclass('extension_records') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='suinda_practice_credit_requests_source_enrollment_fk') THEN
      ALTER TABLE suinda_practice_credit_requests ADD CONSTRAINT suinda_practice_credit_requests_source_enrollment_fk
        FOREIGN KEY (source_enrollment_id) REFERENCES extension_records(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='suinda_practice_credit_requests_target_enrollment_fk') THEN
      ALTER TABLE suinda_practice_credit_requests ADD CONSTRAINT suinda_practice_credit_requests_target_enrollment_fk
        FOREIGN KEY (target_enrollment_id) REFERENCES extension_records(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='suinda_practice_credit_ledger_practice_fk') THEN
      ALTER TABLE suinda_practice_credit_ledger ADD CONSTRAINT suinda_practice_credit_ledger_practice_fk
        FOREIGN KEY (practice_record_id) REFERENCES extension_records(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='suinda_practice_credit_ledger_source_enrollment_fk') THEN
      ALTER TABLE suinda_practice_credit_ledger ADD CONSTRAINT suinda_practice_credit_ledger_source_enrollment_fk
        FOREIGN KEY (source_enrollment_id) REFERENCES extension_records(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='suinda_practice_credit_ledger_target_enrollment_fk') THEN
      ALTER TABLE suinda_practice_credit_ledger ADD CONSTRAINT suinda_practice_credit_ledger_target_enrollment_fk
        FOREIGN KEY (target_enrollment_id) REFERENCES extension_records(id) ON DELETE RESTRICT;
    END IF;
  END IF;
END $$;
