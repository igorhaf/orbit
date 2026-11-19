-- Internal candidate registry only. No institutional approval or activation.
CREATE TABLE discovery_editorial_policy_versions (
 source_id text NOT NULL CHECK(source_id='orbit-editorial-policy-store/1'),
 policy_id text NOT NULL CHECK(policy_id~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$' AND position('..' in policy_id)=0),
 version text NOT NULL CHECK(version~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$' AND position('..' in version)=0),
 content_hash text NOT NULL CHECK(content_hash~'^[0-9a-f]{64}$'),
 discovery_id uuid NOT NULL REFERENCES discovery_journal_entries(id) ON DELETE RESTRICT,
 record jsonb NOT NULL CHECK(jsonb_typeof(record)='object'),
 provenance jsonb NOT NULL CHECK(jsonb_typeof(provenance)='object' AND octet_length(provenance::text)<=2000),
 registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(source_id,policy_id,version),
 UNIQUE(source_id,policy_id,version,content_hash)
);
CREATE TABLE discovery_editorial_policy_events (
 source_id text NOT NULL,policy_id text NOT NULL,version text NOT NULL,revision bigint NOT NULL CHECK(revision>0),
 action text NOT NULL CHECK(action IN ('content_validated','revoked')),
 attributed_actor text NOT NULL CHECK(length(btrim(attributed_actor))>0 AND octet_length(attributed_actor)<=160),
 reason text NOT NULL CHECK(length(btrim(reason))>0 AND octet_length(reason)<=2000),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(source_id,policy_id,version,revision),
 FOREIGN KEY(source_id,policy_id,version) REFERENCES discovery_editorial_policy_versions(source_id,policy_id,version) ON DELETE RESTRICT
);
CREATE FUNCTION orbit_editorial_policy_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h discovery_journal_captures%ROWTYPE; r jsonb; ref jsonb;
BEGIN
 SELECT c.* INTO STRICT h FROM discovery_journal_entries e JOIN discovery_journal_captures c ON c.id=e.capture_id WHERE e.id=NEW.discovery_id;
 r=NEW.record;ref=r->'reference';
 IF NOT(r ?& ARRAY['schemaVersion','reference','scope','status','validFrom','validUntil','policy'])
 OR r-ARRAY['schemaVersion','reference','scope','status','validFrom','validUntil','policy']<>'{}'::jsonb
 OR r->>'schemaVersion' IS DISTINCT FROM '1' OR r->>'status' IS DISTINCT FROM 'unavailable'
 OR ref IS DISTINCT FROM jsonb_build_object('sourceId',NEW.source_id,'id',NEW.policy_id,'version',NEW.version,'hash',NEW.content_hash)
 OR r->'scope' IS DISTINCT FROM jsonb_build_object('discoveryId',NEW.discovery_id,'queue',h.queue,'runtimeId',h.runtime_id,'projectId',h.project_id)
 OR NEW.content_hash IS DISTINCT FROM encode(sha256(convert_to(orbit_discovery_canonical(r-'reference'),'UTF8')),'hex')
 OR jsonb_typeof(r->'policy') IS DISTINCT FROM 'object'
 OR COALESCE(r->>'validFrom','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
 OR COALESCE(r->>'validUntil','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
 OR (r->>'validFrom')::timestamptz >= (r->>'validUntil')::timestamptz
 THEN RAISE EXCEPTION 'editorial policy candidate invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER editorial_policy_version_guard BEFORE INSERT ON discovery_editorial_policy_versions FOR EACH ROW EXECUTE FUNCTION orbit_editorial_policy_version_guard();
CREATE FUNCTION orbit_editorial_policy_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n bigint; last_action text; p jsonb;
BEGIN
 -- All event writers, including direct INSERT, use this parent row lock.
 SELECT record->'policy' INTO STRICT p FROM discovery_editorial_policy_versions WHERE source_id=NEW.source_id AND policy_id=NEW.policy_id AND version=NEW.version FOR UPDATE;
 SELECT revision,action INTO n,last_action FROM discovery_editorial_policy_events WHERE source_id=NEW.source_id AND policy_id=NEW.policy_id AND version=NEW.version ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>COALESCE(n,0)+1 OR last_action='revoked' OR (last_action='content_validated' AND NEW.action='content_validated') THEN RAISE EXCEPTION 'editorial policy governance conflict' USING ERRCODE='23514';END IF;
 IF NEW.action='content_validated' THEN
  IF NOT(p ?& ARRAY['schemaVersion','minimumReviewRevision','requiredEvidenceCompatibility','allowIneligibleApproval'])
   OR p-ARRAY['schemaVersion','minimumReviewRevision','requiredEvidenceCompatibility','allowIneligibleApproval']<>'{}'::jsonb
   OR p->>'schemaVersion' IS DISTINCT FROM '1' OR jsonb_typeof(p->'minimumReviewRevision') IS DISTINCT FROM 'number'
   OR COALESCE(p->>'minimumReviewRevision','')!~'^[1-9][0-9]*$' OR (p->>'minimumReviewRevision')::numeric>9007199254740991
   OR jsonb_typeof(p->'allowIneligibleApproval') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(p->'requiredEvidenceCompatibility') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'requiredEvidenceCompatibility')=0
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'requiredEvidenceCompatibility') x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' NOT IN ('unassessed','compatible','partially_compatible','incompatible','unavailable'))
  THEN RAISE EXCEPTION 'editorial policy content invalid' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER editorial_policy_event_guard BEFORE INSERT ON discovery_editorial_policy_events FOR EACH ROW EXECUTE FUNCTION orbit_editorial_policy_event_guard();
CREATE TRIGGER editorial_policy_versions_immutable BEFORE UPDATE OR DELETE ON discovery_editorial_policy_versions FOR EACH ROW EXECUTE FUNCTION orbit_context_evidence_immutable();
CREATE TRIGGER editorial_policy_versions_no_truncate BEFORE TRUNCATE ON discovery_editorial_policy_versions FOR EACH STATEMENT EXECUTE FUNCTION orbit_context_evidence_immutable();
CREATE TRIGGER editorial_policy_events_immutable BEFORE UPDATE OR DELETE ON discovery_editorial_policy_events FOR EACH ROW EXECUTE FUNCTION orbit_context_evidence_immutable();
CREATE TRIGGER editorial_policy_events_no_truncate BEFORE TRUNCATE ON discovery_editorial_policy_events FOR EACH STATEMENT EXECUTE FUNCTION orbit_context_evidence_immutable();
COMMENT ON TABLE discovery_editorial_policy_versions IS 'Immutable candidates, never institutionally approved/active. No default policy, destructive retention or automatic grants. Provenance and actors are attribution, not credentials. Activation requires future authorized governance.';
COMMENT ON TABLE discovery_editorial_policy_events IS 'Append-only structural validation and candidate revocation. No approved/activated action exists. Parent row serializes writers and candidate pins. Owners/superusers can bypass guards.';
