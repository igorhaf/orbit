-- Additive evidence only: enables no Bridge, MCP, execution or operational credential.
-- Existing product migrations extend past160; 207 follows the maximum across all runtimes.
CREATE TABLE context_bridge_events (
  id uuid PRIMARY KEY,
  event_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
  bridge_id uuid NOT NULL,
  manifest_id uuid NOT NULL REFERENCES context_run_manifests(id),
  queue text NOT NULL CHECK (queue IN ('card_runs','card_ai_runs')),
  run_id uuid NOT NULL,
  turn integer NOT NULL CHECK (turn >= 0),
  runtime_id text NOT NULL CHECK (runtime_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  project_id uuid NOT NULL,
  workspace_id uuid,
  card_id uuid NOT NULL,
  card_revision bigint CHECK (card_revision IS NULL OR card_revision > 0),
  actor_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  context_fingerprint text NOT NULL CHECK (context_fingerprint ~ '^[0-9a-f]{64}$'),
  phase text NOT NULL CHECK (phase IN ('bridge_created','request_received','authorized','response_prepared','response_emitted','delivery_unverified','denied','closed','revoked')),
  request_id text CHECK (request_id IS NULL OR request_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  capability text CHECK (capability IS NULL OR capability ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,127}$'),
  source_ref text CHECK (source_ref IS NULL OR source_ref ~ '^[A-Za-z0-9_-]{1,160}$'),
  source_hash text CHECK (source_hash IS NULL OR source_hash ~ '^[0-9a-f]{64}$'),
  source_identity_hash text CHECK (source_identity_hash IS NULL OR source_identity_hash ~ '^[0-9a-f]{64}$'),
  source_version text CHECK (source_version IS NULL OR source_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$'),
  status text CHECK (status IS NULL OR status ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,127}$'),
  reason text CHECK (reason IS NULL OR reason ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,127}$'),
  response_hash text CHECK (response_hash IS NULL OR response_hash ~ '^[0-9a-f]{64}$'),
  returned_bytes integer NOT NULL DEFAULT 0 CHECK (returned_bytes >= 0),
  charged_bytes integer NOT NULL DEFAULT 0 CHECK (charged_bytes >= 0),
  observed_at timestamptz NOT NULL,
  audit jsonb NOT NULL CHECK (jsonb_typeof(audit)='object' AND audit->'schemaVersion'='1'::jsonb),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX context_bridge_events_manifest_idx ON context_bridge_events(manifest_id,event_sequence DESC);
CREATE INDEX context_bridge_events_bridge_idx ON context_bridge_events(bridge_id,event_sequence);

CREATE FUNCTION orbit_context_bridge_event_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE captured context_run_manifests%ROWTYPE; previous context_bridge_events%ROWTYPE;
BEGIN
  IF jsonb_typeof(NEW.audit->'binding') IS DISTINCT FROM 'object'
    OR jsonb_typeof(NEW.audit->'event') IS DISTINCT FROM 'object'
    OR NEW.audit - ARRAY['schemaVersion','binding','event'] <> '{}'::jsonb
    OR (NEW.audit->'binding') - ARRAY['bridgeId','manifestId','queue','runId','turn','runtimeId','projectId','workspaceId','cardId','cardRevision','actorId','ownerId','contextFingerprint'] <> '{}'::jsonb
    OR (NEW.audit->'event') - ARRAY['phase','requestId','capability','sourceId','sourceHash','sourceIdentityHash','sourceVersion','status','reason','responseHash','returnedBytes','chargedBytes','observedAt'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Bridge audit accepts only metadata allowlists' USING ERRCODE='23514';
  END IF;
  IF NEW.audit->'binding'->>'bridgeId' IS DISTINCT FROM NEW.bridge_id::text
    OR NEW.audit->'binding'->>'manifestId' IS DISTINCT FROM NEW.manifest_id::text
    OR NEW.audit->'binding'->>'queue' IS DISTINCT FROM NEW.queue
    OR NEW.audit->'binding'->>'runId' IS DISTINCT FROM NEW.run_id::text
    OR NEW.audit->'binding'->>'turn' IS DISTINCT FROM NEW.turn::text
    OR NEW.audit->'binding'->>'runtimeId' IS DISTINCT FROM NEW.runtime_id
    OR NEW.audit->'binding'->>'projectId' IS DISTINCT FROM NEW.project_id::text
    OR NEW.audit->'binding'->>'workspaceId' IS DISTINCT FROM NEW.workspace_id::text
    OR NEW.audit->'binding'->>'cardId' IS DISTINCT FROM NEW.card_id::text
    OR NEW.audit->'binding'->>'cardRevision' IS DISTINCT FROM NEW.card_revision::text
    OR NEW.audit->'binding'->>'actorId' IS DISTINCT FROM NEW.actor_id::text
    OR NEW.audit->'binding'->>'ownerId' IS DISTINCT FROM NEW.owner_id::text
    OR NEW.audit->'binding'->>'contextFingerprint' IS DISTINCT FROM NEW.context_fingerprint
    OR NEW.audit->'event'->>'phase' IS DISTINCT FROM NEW.phase
    OR NEW.audit->'event'->>'requestId' IS DISTINCT FROM NEW.request_id
    OR NEW.audit->'event'->>'capability' IS DISTINCT FROM NEW.capability
    OR NEW.audit->'event'->>'sourceId' IS DISTINCT FROM NEW.source_ref
    OR NEW.audit->'event'->>'sourceHash' IS DISTINCT FROM NEW.source_hash
    OR NEW.audit->'event'->>'sourceIdentityHash' IS DISTINCT FROM NEW.source_identity_hash
    OR NEW.audit->'event'->>'sourceVersion' IS DISTINCT FROM NEW.source_version
    OR NEW.audit->'event'->>'status' IS DISTINCT FROM NEW.status
    OR NEW.audit->'event'->>'reason' IS DISTINCT FROM NEW.reason
    OR NEW.audit->'event'->>'responseHash' IS DISTINCT FROM NEW.response_hash
    OR COALESCE(NEW.audit->'event'->>'returnedBytes','0') IS DISTINCT FROM NEW.returned_bytes::text
    OR COALESCE(NEW.audit->'event'->>'chargedBytes','0') IS DISTINCT FROM NEW.charged_bytes::text
    OR (NEW.audit->'event'->>'observedAt')::timestamptz IS DISTINCT FROM NEW.observed_at THEN
    RAISE EXCEPTION 'Bridge event metadata differs from persisted binding' USING ERRCODE='23514';
  END IF;
  SELECT * INTO STRICT captured FROM context_run_manifests WHERE id=NEW.manifest_id;
  IF NEW.queue IS DISTINCT FROM captured.queue OR NEW.run_id IS DISTINCT FROM captured.run_id
    OR NEW.turn IS DISTINCT FROM captured.turn OR NEW.runtime_id IS DISTINCT FROM captured.runtime_id
    OR NEW.project_id IS DISTINCT FROM captured.project_id OR NEW.workspace_id IS DISTINCT FROM captured.workspace_id
    OR NEW.card_id IS DISTINCT FROM captured.card_id OR NEW.card_revision IS DISTINCT FROM captured.card_revision
    OR NEW.actor_id IS DISTINCT FROM captured.actor_id OR NEW.context_fingerprint IS DISTINCT FROM captured.fingerprint
    OR captured.manifest->>'assemblyPolicy' IS DISTINCT FROM 'orbit-context-compiler/1'
    OR captured.manifest->'configuration'->'contextCompilation'->>'status' IS DISTINCT FROM 'ready'
    OR captured.manifest->'configuration'->'contextCompilation'->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR captured.manifest->'configuration'->'contextCompilation'->'policy'->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR captured.manifest->'configuration'->'contextCompilation'->>'compiledHash' IS DISTINCT FROM captured.manifest->'material'->>'promptHash'
    OR COALESCE(captured.manifest->'configuration'->'contextCompilation'->>'fingerprint','') !~ '^[0-9a-f]{64}$'
    OR captured.manifest->'configuration'->'contextCompilation'->'policy'->>'id' IS DISTINCT FROM 'orbit-context-compiler/1' THEN
    RAISE EXCEPTION 'Bridge audit requires its own immutable compiled context' USING ERRCODE='23514';
  END IF;
  -- Serialize the first insert for one Bridge; subsequent events cannot change owner or identity.
  PERFORM pg_advisory_xact_lock(hashtext('context-bridge-audit:'||NEW.bridge_id::text));
  SELECT * INTO previous FROM context_bridge_events WHERE bridge_id=NEW.bridge_id ORDER BY event_sequence LIMIT 1;
  IF FOUND AND NEW.audit->'binding' IS DISTINCT FROM previous.audit->'binding' THEN
    RAISE EXCEPTION 'A Bridge cannot change its captured execution binding' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER context_bridge_events_binding BEFORE INSERT ON context_bridge_events
  FOR EACH ROW EXECUTE FUNCTION orbit_context_bridge_event_binding();
CREATE TRIGGER context_bridge_events_immutable BEFORE UPDATE OR DELETE ON context_bridge_events
  FOR EACH ROW EXECUTE FUNCTION orbit_context_evidence_immutable();
CREATE TRIGGER context_bridge_events_no_truncate BEFORE TRUNCATE ON context_bridge_events
  FOR EACH STATEMENT EXECUTE FUNCTION orbit_context_evidence_immutable();
COMMENT ON TABLE context_bridge_events IS 'Append-only bounded metadata for read-only Bridge calls. response_prepared precedes handoff; response_emitted is host adapter intake evidence, never proof that a model received, interpreted or used content. No tokens, paths or source bodies; retention requires explicit administrative policy.';
