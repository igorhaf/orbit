-- 07C proposed discoveries only. No approval, RAG injection, MCP, operational
-- activation or destructive retention. Administrator bypass is out of scope.
CREATE FUNCTION orbit_discovery_canonical(v jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result text;
BEGIN
 CASE jsonb_typeof(v)
 WHEN 'object' THEN SELECT '{'||COALESCE(string_agg(to_jsonb(key)::text||':'||orbit_discovery_canonical(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(v);
 WHEN 'array' THEN SELECT '['||COALESCE(string_agg(orbit_discovery_canonical(value),',' ORDER BY ord),'')||']' INTO result FROM jsonb_array_elements(v) WITH ORDINALITY a(value,ord);
 ELSE result=v::text;
 END CASE;
 RETURN result;
END; $$;
CREATE FUNCTION orbit_discovery_proposal_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE e jsonb; loc jsonb;
BEGIN
 IF v IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object'
 OR NOT (v ?& ARRAY['category','statement','evidence','proposalHash']) OR v-ARRAY['category','statement','evidence','proposalHash']<>'{}'::jsonb
 OR COALESCE(v->>'category','') NOT IN ('technical_observation','dependency_candidate','risk_candidate','hypothesis','incompatibility_report','decision_proposal','documentation_reference')
 OR jsonb_typeof(v->'statement') IS DISTINCT FROM 'string' OR length(btrim(v->>'statement'))=0 OR octet_length(v->>'statement')>2048
 OR jsonb_typeof(v->'evidence') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'evidence')>8
 OR COALESCE(v->>'proposalHash','') !~ '^[0-9a-f]{64}$'
 OR v->>'proposalHash' IS DISTINCT FROM encode(sha256(convert_to(orbit_discovery_canonical(v-'proposalHash'),'UTF8')),'hex') THEN RETURN false; END IF;
 FOR e IN SELECT * FROM jsonb_array_elements(v->'evidence') LOOP
  IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR NOT(e ?& ARRAY['kind','reference','hash','version','state']) OR e-ARRAY['kind','reference','hash','version','state','location']<>'{}'::jsonb
  OR COALESCE(e->>'kind','') NOT IN ('manifest_source','artifact','declared_reference')
  OR jsonb_typeof(e->'reference') IS DISTINCT FROM 'string' OR COALESCE(e->>'reference','')!~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$' OR position('..' in e->>'reference')>0
  OR COALESCE(e->>'state','') NOT IN ('historical_reference','verified','unverified','unavailable','changed')
  OR NOT(e->'hash'='null'::jsonb OR jsonb_typeof(e->'hash')='string' AND e->>'hash'~'^[0-9a-f]{64}$')
  OR NOT(e->'version'='null'::jsonb OR jsonb_typeof(e->'version')='string' AND e->>'version'~'^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$') THEN RETURN false; END IF;
  IF e ? 'location' THEN
   loc=e->'location';
   IF jsonb_typeof(loc) IS DISTINCT FROM 'object' OR NOT(loc ?& ARRAY['startLine','endLine']) OR loc-ARRAY['startLine','endLine']<>'{}'::jsonb
    OR jsonb_typeof(loc->'startLine') IS DISTINCT FROM 'number' OR jsonb_typeof(loc->'endLine') IS DISTINCT FROM 'number'
    OR COALESCE(loc->>'startLine','')!~'^[0-9]+$' OR COALESCE(loc->>'endLine','')!~'^[0-9]+$' THEN RETURN false; END IF;
   IF (loc->>'startLine')::numeric<1 OR (loc->>'endLine')::numeric<(loc->>'startLine')::numeric OR (loc->>'endLine')::numeric>10000000 THEN RETURN false; END IF;
  END IF;
 END LOOP;
 RETURN true;
END; $$;
CREATE FUNCTION orbit_discovery_submission_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE p jsonb;
BEGIN
 IF v IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT(v ?& ARRAY['submissionKey','artifactId','artifactHash','origin','executor','policy','proposals'])
 OR v-ARRAY['submissionKey','artifactId','artifactHash','origin','executor','policy','proposals']<>'{}'::jsonb OR octet_length(orbit_discovery_canonical(v))>30000
 OR jsonb_typeof(v->'submissionKey') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'artifactId') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'artifactHash') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'origin') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'executor') IS DISTINCT FROM 'string'
 OR COALESCE(v->>'submissionKey','')!~'^[0-9a-f]{64}$' OR COALESCE(v->>'artifactHash','')!~'^[0-9a-f]{64}$'
 OR COALESCE(v->>'artifactId','')!~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$' OR position('..' in v->>'artifactId')>0
 OR COALESCE(v->>'origin','') NOT IN ('structured_output','authorized_submission','artifact') OR COALESCE(v->>'executor','')!~'^[-A-Za-z0-9_.:]{1,64}$'
 OR v->'policy' IS DISTINCT FROM '{"schemaVersion":1,"id":"orbit-discovery-capture/1","retention":"explicit_admin_policy","textHandling":"review_required","maxProposals":8,"maxStatementBytes":2048}'::jsonb
 OR jsonb_typeof(v->'proposals') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'proposals') NOT BETWEEN 1 AND 8 THEN RETURN false; END IF;
 FOR p IN SELECT * FROM jsonb_array_elements(v->'proposals') LOOP IF NOT orbit_discovery_proposal_valid(p) THEN RETURN false; END IF; END LOOP;
 RETURN true;
END; $$;
CREATE TABLE discovery_journal_captures (
 id uuid PRIMARY KEY,
 runtime_id text NOT NULL CHECK(runtime_id~'^[a-z0-9][a-z0-9._-]{0,63}$'),project_id uuid NOT NULL,workspace_id uuid,actor_id uuid NOT NULL,card_id uuid NOT NULL,card_revision bigint NOT NULL CHECK(card_revision>0),
 queue text NOT NULL CHECK(queue IN ('card_runs','card_ai_runs')),run_id uuid NOT NULL,turn integer NOT NULL CHECK(turn>=0),manifest_id uuid NOT NULL REFERENCES context_run_manifests(id),
 context_fingerprint text NOT NULL CHECK(context_fingerprint~'^[0-9a-f]{64}$'),submission_key text NOT NULL CHECK(submission_key~'^[0-9a-f]{64}$'),submission_hash text NOT NULL CHECK(submission_hash~'^[0-9a-f]{64}$'),
 binding jsonb NOT NULL CHECK(jsonb_typeof(binding)='object'),submission jsonb NOT NULL CHECK(jsonb_typeof(submission)='object' AND NOT(submission ? 'proposals')),
 proposal_count integer NOT NULL CHECK(proposal_count BETWEEN 1 AND 8),recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(runtime_id,queue,run_id,turn,submission_key)
);
CREATE TABLE discovery_journal_entries (
 id uuid PRIMARY KEY,capture_id uuid NOT NULL REFERENCES discovery_journal_captures(id),position integer NOT NULL CHECK(position BETWEEN 0 AND 7),
 schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),category text NOT NULL,proposal_hash text NOT NULL CHECK(proposal_hash~'^[0-9a-f]{64}$'),proposal jsonb NOT NULL CHECK(orbit_discovery_proposal_valid(proposal)),
 review_state text NOT NULL DEFAULT 'proposed' CHECK(review_state='proposed'),verification text NOT NULL DEFAULT 'review_required' CHECK(verification='review_required'),recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK(proposal->>'category'=category AND proposal->>'proposalHash'=proposal_hash),UNIQUE(capture_id,position)
);
CREATE INDEX discovery_journal_scope_idx ON discovery_journal_captures(runtime_id,project_id,workspace_id,actor_id,queue,run_id,card_id,recorded_at DESC);
CREATE INDEX discovery_journal_entries_capture_idx ON discovery_journal_entries(capture_id,position);
CREATE FUNCTION orbit_discovery_binding_valid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m context_run_manifests%ROWTYPE; r record; b jsonb; current_revision bigint;
BEGIN
 b=NEW.binding;
 IF NOT(b ?& ARRAY['runtimeId','projectId','workspaceId','actorId','cardId','cardRevision','queue','runId','turn','manifestId','contextFingerprint','workerId'])
 OR b-ARRAY['runtimeId','projectId','workspaceId','actorId','cardId','cardRevision','queue','runId','turn','manifestId','contextFingerprint','workerId']<>'{}'::jsonb
 OR b->>'runtimeId' IS DISTINCT FROM NEW.runtime_id OR b->>'projectId' IS DISTINCT FROM NEW.project_id::text OR b->>'workspaceId' IS DISTINCT FROM NEW.workspace_id::text OR b->>'actorId' IS DISTINCT FROM NEW.actor_id::text
 OR b->>'cardId' IS DISTINCT FROM NEW.card_id::text OR b->>'cardRevision' IS DISTINCT FROM NEW.card_revision::text OR b->>'queue' IS DISTINCT FROM NEW.queue OR b->>'runId' IS DISTINCT FROM NEW.run_id::text OR b->>'turn' IS DISTINCT FROM NEW.turn::text
 OR b->>'manifestId' IS DISTINCT FROM NEW.manifest_id::text OR b->>'contextFingerprint' IS DISTINCT FROM NEW.context_fingerprint OR COALESCE(b->>'workerId','')!~'^[-A-Za-z0-9_.:]{1,160}$'
 THEN RAISE EXCEPTION 'Discovery binding invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT m FROM context_run_manifests WHERE id=NEW.manifest_id FOR SHARE;
 IF m.runtime_id IS DISTINCT FROM NEW.runtime_id OR m.project_id IS DISTINCT FROM NEW.project_id OR m.workspace_id IS DISTINCT FROM NEW.workspace_id OR m.actor_id IS DISTINCT FROM NEW.actor_id OR m.card_id IS DISTINCT FROM NEW.card_id
 OR m.card_revision IS DISTINCT FROM NEW.card_revision OR m.queue IS DISTINCT FROM NEW.queue OR m.run_id IS DISTINCT FROM NEW.run_id OR m.turn IS DISTINCT FROM NEW.turn OR m.fingerprint IS DISTINCT FROM NEW.context_fingerprint THEN RAISE EXCEPTION 'Discovery historical binding invalid' USING ERRCODE='23514'; END IF;
 EXECUTE format('SELECT id,user_id,project_id,card_id,card_revision,status,worker_id%s FROM %I WHERE id=$1 FOR UPDATE',CASE WHEN NEW.queue='card_runs' THEN ',cancel_requested' ELSE '' END,NEW.queue) INTO r USING NEW.run_id;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Discovery run unavailable' USING ERRCODE='23514'; END IF;
 -- Match prompt continuation lock order: run row first, then the exact
 -- ContextManifestRepository.store advisory authority, then latest-turn check.
 PERFORM pg_advisory_xact_lock(hashtext('context-manifest:'||NEW.queue||':'||NEW.run_id::text));
 IF EXISTS(SELECT 1 FROM context_run_manifests WHERE queue=NEW.queue AND run_id=NEW.run_id AND turn>NEW.turn) THEN RAISE EXCEPTION 'Discovery historical turn superseded' USING ERRCODE='23514'; END IF;
 IF r.user_id IS DISTINCT FROM NEW.actor_id OR r.project_id IS DISTINCT FROM NEW.project_id OR r.card_id IS DISTINCT FROM NEW.card_id OR r.card_revision IS DISTINCT FROM NEW.card_revision OR r.status IS DISTINCT FROM 'running' OR r.worker_id IS DISTINCT FROM b->>'workerId' THEN RAISE EXCEPTION 'Discovery run inactive or unauthorized' USING ERRCODE='23514'; END IF;
 IF NEW.queue='card_runs' THEN IF r.cancel_requested IS TRUE THEN RAISE EXCEPTION 'Discovery run cancelled' USING ERRCODE='23514'; END IF; END IF;
 SELECT card_revision INTO STRICT current_revision FROM cards WHERE id=NEW.card_id FOR SHARE;
 IF current_revision IS DISTINCT FROM NEW.card_revision THEN RAISE EXCEPTION 'Discovery card revision changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER discovery_journal_capture_binding BEFORE INSERT ON discovery_journal_captures FOR EACH ROW EXECUTE FUNCTION orbit_discovery_binding_valid();
CREATE FUNCTION orbit_discovery_entry_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h discovery_journal_captures%ROWTYPE;
BEGIN
 SELECT * INTO STRICT h FROM discovery_journal_captures WHERE id=NEW.capture_id;
 IF NEW.position>=h.proposal_count OR NEW.recorded_at IS DISTINCT FROM h.recorded_at THEN RAISE EXCEPTION 'Discovery position/time invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER discovery_journal_entry_binding BEFORE INSERT ON discovery_journal_entries FOR EACH ROW EXECUTE FUNCTION orbit_discovery_entry_binding();
CREATE TRIGGER discovery_journal_captures_immutable BEFORE UPDATE OR DELETE ON discovery_journal_captures FOR EACH ROW EXECUTE FUNCTION orbit_context_evidence_immutable();
CREATE TRIGGER discovery_journal_entries_immutable BEFORE UPDATE OR DELETE ON discovery_journal_entries FOR EACH ROW EXECUTE FUNCTION orbit_context_evidence_immutable();
CREATE TRIGGER discovery_journal_captures_no_truncate BEFORE TRUNCATE ON discovery_journal_captures FOR EACH STATEMENT EXECUTE FUNCTION orbit_context_evidence_immutable();
CREATE TRIGGER discovery_journal_entries_no_truncate BEFORE TRUNCATE ON discovery_journal_entries FOR EACH STATEMENT EXECUTE FUNCTION orbit_context_evidence_immutable();
CREATE FUNCTION orbit_discovery_capture(b jsonb,s jsonb,submission_digest text)
RETURNS TABLE(capture_status text,id uuid,capture_id uuid,"position" integer,proposal jsonb,recorded_at timestamptz,binding jsonb,submission jsonb)
LANGUAGE plpgsql VOLATILE AS $$
DECLARE h discovery_journal_captures%ROWTYPE; cid uuid; p jsonb; n integer=0; state text='persisted';
BEGIN
 IF NOT orbit_discovery_submission_valid(s) OR submission_digest IS DISTINCT FROM encode(sha256(convert_to(orbit_discovery_canonical(s),'UTF8')),'hex') THEN RAISE EXCEPTION 'Discovery submission invalid' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':','discovery-journal',b->>'runtimeId',b->>'queue',b->>'runId',b->>'turn',s->>'submissionKey'),0));
 SELECT * INTO h FROM discovery_journal_captures c WHERE c.runtime_id=b->>'runtimeId' AND c.queue=b->>'queue' AND c.run_id=(b->>'runId')::uuid AND c.turn=(b->>'turn')::integer AND c.submission_key=s->>'submissionKey';
 IF FOUND THEN
  -- Retry cannot widen scope or replace historical content/author. Worker may
  -- differ only after the host separately authorizes a retry; no new write.
  IF h.submission_hash IS DISTINCT FROM submission_digest OR h.binding-'workerId' IS DISTINCT FROM b-'workerId' THEN RAISE EXCEPTION 'Discovery idempotency conflict' USING ERRCODE='23505'; END IF;
  cid=h.id; state='duplicate';
 ELSE
  cid=gen_random_uuid();
  INSERT INTO discovery_journal_captures(id,runtime_id,project_id,workspace_id,actor_id,card_id,card_revision,queue,run_id,turn,manifest_id,context_fingerprint,submission_key,submission_hash,binding,submission,proposal_count)
  VALUES(cid,b->>'runtimeId',(b->>'projectId')::uuid,(b->>'workspaceId')::uuid,(b->>'actorId')::uuid,(b->>'cardId')::uuid,(b->>'cardRevision')::bigint,b->>'queue',(b->>'runId')::uuid,(b->>'turn')::integer,(b->>'manifestId')::uuid,b->>'contextFingerprint',s->>'submissionKey',submission_digest,b,s-'proposals',jsonb_array_length(s->'proposals')) RETURNING * INTO h;
  FOR p IN SELECT * FROM jsonb_array_elements(s->'proposals') LOOP
   INSERT INTO discovery_journal_entries(id,capture_id,position,category,proposal_hash,proposal,recorded_at) VALUES(gen_random_uuid(),cid,n,p->>'category',p->>'proposalHash',p,h.recorded_at);n=n+1;
  END LOOP;
 END IF;
 RETURN QUERY SELECT state,e.id,e.capture_id,e.position,e.proposal,e.recorded_at,h.binding,h.submission FROM discovery_journal_entries e WHERE e.capture_id=cid ORDER BY e.position;
END; $$;
COMMENT ON TABLE discovery_journal_captures IS 'Immutable host-observed structured discovery captures. No full outputs, prompts or manifests. Scope IDs are not credentials. Retention requires explicit authorized policy; no cleanup routine.';
COMMENT ON TABLE discovery_journal_entries IS 'Bounded proposed statements and safe evidence references; always review_required. Hashes establish identity, not semantic truth, approval or current knowledge. Never automatically indexed by lexical retrieval.';

-- Deferred completeness/hash check prevents direct partial INSERTs from becoming
-- committed captures, while allowing the host function to insert the bounded batch.
CREATE FUNCTION orbit_discovery_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h discovery_journal_captures%ROWTYPE; payload jsonb; count_entries integer; target_id uuid;
BEGIN
 IF TG_TABLE_NAME='discovery_journal_captures' THEN target_id=NEW.id; ELSE target_id=NEW.capture_id; END IF;
 SELECT * INTO STRICT h FROM discovery_journal_captures WHERE id=target_id;
 SELECT count(*),COALESCE(jsonb_agg(e.proposal ORDER BY e.position),'[]'::jsonb) INTO count_entries,payload FROM discovery_journal_entries e WHERE e.capture_id=h.id;
 payload=h.submission||jsonb_build_object('proposals',payload);
 IF count_entries<>h.proposal_count OR NOT orbit_discovery_submission_valid(payload) OR h.submission_hash IS DISTINCT FROM encode(sha256(convert_to(orbit_discovery_canonical(payload),'UTF8')),'hex') OR h.submission_key IS DISTINCT FROM h.submission->>'submissionKey' THEN RAISE EXCEPTION 'Discovery capture incomplete or changed' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER discovery_journal_capture_complete AFTER INSERT ON discovery_journal_captures DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orbit_discovery_complete();
CREATE CONSTRAINT TRIGGER discovery_journal_entry_complete AFTER INSERT ON discovery_journal_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orbit_discovery_complete();

-- Latest capture receipt is observability, not immutable discovery history.
ALTER TABLE card_ai_runs ADD COLUMN discovery_capture jsonb NOT NULL DEFAULT '{}'::jsonb
 CHECK(jsonb_typeof(discovery_capture)='object' AND octet_length(discovery_capture::text)<=2000);
