-- Isolation is opt-in in the host. This migration does not enable it.
ALTER TABLE card_ai_runs ADD COLUMN checkout_request jsonb;
ALTER TABLE card_ai_runs ADD COLUMN request_key text;
CREATE UNIQUE INDEX card_ai_runs_request_key_idx ON card_ai_runs(card_id,request_key) WHERE request_key IS NOT NULL;

-- A polymorphic run identity is intentional: both existing queues keep their
-- ownership/revision contracts and retained evidence outlives card deletion.
CREATE TABLE isolated_run_checkouts (
  queue text NOT NULL CHECK (queue IN ('card_runs','card_ai_runs')),
  run_id uuid NOT NULL,
  card_id uuid NOT NULL,
  card_revision bigint,
  project_id uuid NOT NULL,
  workspace_id uuid,
  owner_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('preparing','ready','running','ended','awaiting_answer','preserved','blocked','quarantined','discard_eligible')),
  identity jsonb NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  diagnostic text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (queue,run_id)
);
CREATE INDEX isolated_run_checkouts_card_idx ON isolated_run_checkouts(card_id,created_at DESC);
COMMENT ON TABLE isolated_run_checkouts IS 'Technical checkout evidence only. Execution success never grants integration approval; no automatic discard.';
