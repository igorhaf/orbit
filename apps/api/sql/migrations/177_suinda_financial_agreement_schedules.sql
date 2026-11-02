ALTER TABLE suinda_financial_negotiation_cases
  DROP CONSTRAINT IF EXISTS suinda_financial_negotiation_cases_status_check;
ALTER TABLE suinda_financial_negotiation_cases
  ADD CONSTRAINT suinda_financial_negotiation_cases_status_check
  CHECK (status IN ('pending_institution','pending_student','agreed_draft','agreed_formalized','declined','withdrawn'));

ALTER TABLE suinda_financial_negotiation_events
  DROP CONSTRAINT IF EXISTS suinda_financial_negotiation_events_event_type_check;
ALTER TABLE suinda_financial_negotiation_events
  ADD CONSTRAINT suinda_financial_negotiation_events_event_type_check
  CHECK (event_type IN ('requested','counterproposal','institution_accepted_draft','institution_declined',
    'learner_accepted_draft','learner_accepted_and_formalized','learner_declined','learner_withdrew'));

ALTER TABLE suinda_financial_negotiation_cases
  ADD CONSTRAINT suinda_financial_negotiation_case_workspace_enrollment_id_unique UNIQUE(workspace_id,enrollment_id,id);

CREATE TABLE suinda_financial_agreements (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  enrollment_id uuid NOT NULL REFERENCES extension_records(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  case_id uuid NOT NULL UNIQUE,
  learner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_case_revision integer NOT NULL CHECK (source_case_revision > 0),
  amount numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  installment_count integer NOT NULL CHECK (installment_count BETWEEN 1 AND 24),
  first_due_on date NOT NULL,
  interval_days integer NOT NULL CHECK (interval_days BETWEEN 1 AND 365),
  terms_snapshot jsonb NOT NULL CHECK (jsonb_typeof(terms_snapshot)='object'),
  effective_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,enrollment_id,revision),
  UNIQUE(workspace_id,case_id),
  FOREIGN KEY(workspace_id,enrollment_id,case_id)
    REFERENCES suinda_financial_negotiation_cases(workspace_id,enrollment_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(enrollment_id,workspace_id) REFERENCES extension_records(id,workspace_id) ON DELETE RESTRICT
);
CREATE INDEX suinda_financial_agreements_current_idx
  ON suinda_financial_agreements(workspace_id,enrollment_id,effective_at DESC,revision DESC);

CREATE TABLE suinda_financial_agreement_installments (
  workspace_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  agreement_revision integer NOT NULL,
  installment_number integer NOT NULL CHECK (installment_number BETWEEN 1 AND 24),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  due_on date NOT NULL,
  source_case_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,enrollment_id,agreement_revision,installment_number),
  FOREIGN KEY(workspace_id,enrollment_id,agreement_revision)
    REFERENCES suinda_financial_agreements(workspace_id,enrollment_id,revision) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,source_case_id)
    REFERENCES suinda_financial_negotiation_cases(workspace_id,id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION suinda_financial_agreement_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Suindá formal financial agreement snapshots are immutable';
END;
$$;
CREATE TRIGGER suinda_financial_agreements_immutable
  BEFORE UPDATE OR DELETE ON suinda_financial_agreements
  FOR EACH ROW EXECUTE FUNCTION suinda_financial_agreement_snapshot_immutable();
CREATE TRIGGER suinda_financial_agreement_installments_immutable
  BEFORE UPDATE OR DELETE ON suinda_financial_agreement_installments
  FOR EACH ROW EXECUTE FUNCTION suinda_financial_agreement_snapshot_immutable();
