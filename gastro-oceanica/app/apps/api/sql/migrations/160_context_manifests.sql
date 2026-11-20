-- Evidence only: does not enable isolation, IA, retention, integration or execution.
-- Deliberately independent of card/run/project FK lifetimes for retained audit data.
CREATE TABLE context_run_manifests (
  id uuid PRIMARY KEY,
  queue text NOT NULL CHECK (queue IN ('card_runs','card_ai_runs')),
  run_id uuid NOT NULL,
  turn integer NOT NULL CHECK (turn >= 0),
  parent_id uuid REFERENCES context_run_manifests(id),
  card_id uuid NOT NULL,
  card_revision bigint CHECK (card_revision IS NULL OR card_revision > 0),
  project_id uuid NOT NULL,
  workspace_id uuid,
  actor_id uuid NOT NULL,
  runtime_id text NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  integrity_hash text NOT NULL CHECK (integrity_hash ~ '^[0-9a-f]{64}$'),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest)='object' AND manifest ? 'schemaVersion' AND manifest->>'schemaVersion'='1'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(queue,run_id,turn),
  CHECK ((turn=0 AND parent_id IS NULL) OR (turn>0 AND parent_id IS NOT NULL))
);
CREATE UNIQUE INDEX context_run_manifests_parent_idx ON context_run_manifests(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX context_run_manifests_card_idx ON context_run_manifests(card_id,created_at DESC);
CREATE INDEX context_run_manifests_project_idx ON context_run_manifests(project_id,workspace_id,created_at DESC);

CREATE TABLE context_manifest_verifications (
  id uuid PRIMARY KEY,
  manifest_id uuid NOT NULL REFERENCES context_run_manifests(id),
  phase text NOT NULL,
  status text NOT NULL CHECK (status IN ('captured','unverified','compatible','changed','unavailable','legacy')),
  observation jsonb NOT NULL CHECK (jsonb_typeof(observation)='object'),
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX context_manifest_verifications_manifest_idx ON context_manifest_verifications(manifest_id,observed_at,id);

CREATE FUNCTION orbit_context_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Context evidence is immutable; retention requires a separate explicit administrative policy' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER context_run_manifests_immutable BEFORE UPDATE OR DELETE ON context_run_manifests
  FOR EACH ROW EXECUTE FUNCTION orbit_context_evidence_immutable();
CREATE TRIGGER context_manifest_verifications_immutable BEFORE UPDATE OR DELETE ON context_manifest_verifications
  FOR EACH ROW EXECUTE FUNCTION orbit_context_evidence_immutable();
CREATE TRIGGER context_run_manifests_no_truncate BEFORE TRUNCATE ON context_run_manifests
  FOR EACH STATEMENT EXECUTE FUNCTION orbit_context_evidence_immutable();
CREATE TRIGGER context_manifest_verifications_no_truncate BEFORE TRUNCATE ON context_manifest_verifications
  FOR EACH STATEMENT EXECUTE FUNCTION orbit_context_evidence_immutable();

CREATE FUNCTION orbit_context_manifest_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent context_run_manifests%ROWTYPE;
BEGIN
  IF NEW.manifest->'identity'->>'queue' IS DISTINCT FROM NEW.queue
    OR NEW.manifest->'identity'->>'runId' IS DISTINCT FROM NEW.run_id::text
    OR NEW.manifest->'identity'->>'cardId' IS DISTINCT FROM NEW.card_id::text
    OR NEW.manifest->'identity'->>'cardRevision' IS DISTINCT FROM NEW.card_revision::text
    OR NEW.manifest->'identity'->>'projectId' IS DISTINCT FROM NEW.project_id::text
    OR NEW.manifest->'identity'->>'workspaceId' IS DISTINCT FROM NEW.workspace_id::text
    OR NEW.manifest->'identity'->>'actorId' IS DISTINCT FROM NEW.actor_id::text
    OR NEW.manifest->'identity'->>'runtimeId' IS DISTINCT FROM NEW.runtime_id
    OR NEW.manifest->>'fingerprint' IS DISTINCT FROM NEW.fingerprint
    OR NEW.manifest->>'integrityHash' IS DISTINCT FROM NEW.integrity_hash THEN
    RAISE EXCEPTION 'Context manifest identity differs from its persisted binding' USING ERRCODE='23514';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO STRICT parent FROM context_run_manifests WHERE id=NEW.parent_id;
    IF NEW.queue IS DISTINCT FROM parent.queue OR NEW.run_id IS DISTINCT FROM parent.run_id
      OR NEW.turn <> parent.turn+1 OR NEW.manifest->'identity' IS DISTINCT FROM parent.manifest->'identity' THEN
      RAISE EXCEPTION 'Context continuation requires its own run identity and preceding turn' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER context_run_manifests_binding BEFORE INSERT ON context_run_manifests
  FOR EACH ROW EXECUTE FUNCTION orbit_context_manifest_binding();
COMMENT ON TABLE context_run_manifests IS 'Immutable context snapshots, including same-run answer turns. No FK cascade from card/run deletion; privacy and retention require explicit policy.';
COMMENT ON TABLE context_manifest_verifications IS 'Append-only compatibility and delivery observations. Compatible is observational and never semantic or integration approval.';
