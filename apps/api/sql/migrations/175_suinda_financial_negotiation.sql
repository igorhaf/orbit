CREATE TABLE IF NOT EXISTS suinda_financial_negotiation_cases (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  enrollment_id uuid NOT NULL REFERENCES extension_records(id) ON DELETE RESTRICT,
  learner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_type text NOT NULL CHECK (request_type IN ('negotiation','renegotiation')),
  status text NOT NULL CHECK (status IN ('pending_institution','pending_student','agreed_draft','declined','withdrawn')),
  latest_terms jsonb NOT NULL CHECK (jsonb_typeof(latest_terms)='object'),
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS suinda_financial_negotiation_open_enrollment_idx
  ON suinda_financial_negotiation_cases(workspace_id,enrollment_id)
  WHERE status IN ('pending_institution','pending_student');
CREATE INDEX IF NOT EXISTS suinda_financial_negotiation_workspace_queue_idx
  ON suinda_financial_negotiation_cases(workspace_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS suinda_financial_negotiation_learner_idx
  ON suinda_financial_negotiation_cases(learner_user_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS suinda_financial_negotiation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('requested','counterproposal','institution_accepted_draft','institution_declined','learner_accepted_draft','learner_declined','learner_withdrew')),
  terms jsonb NOT NULL CHECK (jsonb_typeof(terms)='object'),
  notes text CHECK (notes IS NULL OR length(notes)<=1000),
  operation_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(case_id,sequence),
  UNIQUE(case_id,operation_key),
  FOREIGN KEY(workspace_id,case_id) REFERENCES suinda_financial_negotiation_cases(workspace_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS suinda_financial_negotiation_events_history_idx
  ON suinda_financial_negotiation_events(workspace_id,case_id,sequence);

CREATE OR REPLACE FUNCTION suinda_financial_negotiation_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Suindá financial negotiation events are immutable';
END;
$$;
DROP TRIGGER IF EXISTS suinda_financial_negotiation_event_immutable ON suinda_financial_negotiation_events;
CREATE TRIGGER suinda_financial_negotiation_event_immutable
  BEFORE UPDATE OR DELETE ON suinda_financial_negotiation_events
  FOR EACH ROW EXECUTE FUNCTION suinda_financial_negotiation_event_immutable();
