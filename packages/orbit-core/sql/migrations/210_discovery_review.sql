-- 07D-B: decisions are the only editorial source of truth. No publication grant.
CREATE TABLE discovery_review_decisions (
 discovery_id uuid NOT NULL REFERENCES discovery_journal_entries(id) ON DELETE RESTRICT,
 queue text NOT NULL CHECK(queue IN ('card_runs','card_ai_runs')),
 review_revision bigint NOT NULL CHECK(review_revision BETWEEN 1 AND 9007199254740991),
 expected_revision bigint NOT NULL CHECK(expected_revision=review_revision-1),
 state text NOT NULL CHECK(state IN ('in_review','needs_information','approved','rejected','approval_withdrawn')),
 action text NOT NULL CHECK(action IN ('start_review','request_information','approve','reject','withdraw_approval')),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 160),
 request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),
 command jsonb NOT NULL CHECK(jsonb_typeof(command)='object'),
 decision jsonb NOT NULL CHECK(jsonb_typeof(decision)='object'),
 evidence_compatibility text NOT NULL CHECK(evidence_compatibility IN ('unassessed','compatible','partially_compatible','incompatible','unavailable')),
 policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object'),
 persisted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(discovery_id,review_revision), UNIQUE(discovery_id,idempotency_key)
);
CREATE FUNCTION orbit_discovery_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous discovery_review_decisions%ROWTYPE; before_state text='proposed'; n bigint=0; source_queue text; expected_state text; c jsonb; d jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('discovery-review:'||NEW.discovery_id::text,0));
 SELECT h.queue INTO STRICT source_queue FROM discovery_journal_entries e JOIN discovery_journal_captures h ON h.id=e.capture_id WHERE e.id=NEW.discovery_id;
 IF source_queue<>NEW.queue THEN RAISE EXCEPTION 'review origin invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO previous FROM discovery_review_decisions WHERE discovery_id=NEW.discovery_id ORDER BY review_revision DESC LIMIT 1;
 IF FOUND THEN before_state=previous.state;n=previous.review_revision;END IF;
 IF NEW.expected_revision<>n OR NEW.review_revision<>n+1 THEN RAISE EXCEPTION 'review conflict' USING ERRCODE='PDR01';END IF;
 expected_state=CASE
 WHEN NEW.action='start_review' AND before_state IN ('proposed','needs_information') THEN 'in_review'
 WHEN NEW.action='request_information' AND before_state='in_review' THEN 'needs_information'
 WHEN NEW.action='approve' AND before_state='in_review' THEN 'approved'
 WHEN NEW.action='reject' AND before_state IN ('in_review','needs_information') THEN 'rejected'
 WHEN NEW.action='withdraw_approval' AND before_state='approved' THEN 'approval_withdrawn' END;
 IF expected_state IS NULL OR expected_state<>NEW.state THEN RAISE EXCEPTION 'review transition invalid' USING ERRCODE='23514';END IF;
 c=NEW.command;d=NEW.decision;
 IF NOT(c ?& ARRAY['action','expectedReviewRevision','reviewerId','idempotencyKey','reason','recordedAt','informationRequest'])
 OR c-ARRAY['action','expectedReviewRevision','reviewerId','idempotencyKey','reason','recordedAt','informationRequest']<>'{}'::jsonb
 OR jsonb_typeof(c->'action') IS DISTINCT FROM 'string' OR jsonb_typeof(c->'expectedReviewRevision') IS DISTINCT FROM 'number' OR jsonb_typeof(c->'idempotencyKey') IS DISTINCT FROM 'string'
 OR c->>'action' IS DISTINCT FROM NEW.action OR c->>'expectedReviewRevision' IS DISTINCT FROM NEW.expected_revision::text
 OR c->>'idempotencyKey' IS DISTINCT FROM NEW.idempotency_key
 OR jsonb_typeof(c->'reviewerId') IS DISTINCT FROM 'string' OR length(btrim(c->>'reviewerId'))=0 OR octet_length(c->>'reviewerId')>160
 OR jsonb_typeof(c->'reason') IS DISTINCT FROM 'string' OR length(btrim(c->>'reason'))=0 OR octet_length(c->>'reason')>2000
 OR COALESCE(c->>'recordedAt','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
 OR to_char((c->>'recordedAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') IS DISTINCT FROM c->>'recordedAt'
 OR NOT(c->'informationRequest'='null'::jsonb OR jsonb_typeof(c->'informationRequest')='string' AND octet_length(c->>'informationRequest')<=2000)
 OR (NEW.action='request_information' AND length(btrim(COALESCE(c->>'informationRequest','')))=0)
 OR NEW.request_hash IS DISTINCT FROM encode(sha256(convert_to(orbit_discovery_canonical(c||jsonb_build_object('discoveryId',NEW.discovery_id)),'UTF8')),'hex')
 THEN RAISE EXCEPTION 'review command invalid' USING ERRCODE='23514';END IF;
 IF d IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'decisionId',encode(sha256(convert_to(orbit_discovery_canonical(jsonb_build_object('discoveryId',NEW.discovery_id,'idempotencyKey',NEW.idempotency_key)),'UTF8')),'hex'),'discoveryId',NEW.discovery_id,'expectedReviewRevision',NEW.expected_revision,'action',NEW.action,'reviewerId',c->>'reviewerId','idempotencyKey',NEW.idempotency_key,'reason',btrim(c->>'reason'),'informationRequest',nullif(btrim(c->>'informationRequest'),''),'recordedAt',c->>'recordedAt','cas',jsonb_build_object('expectedRevision',NEW.expected_revision,'nextRevision',NEW.review_revision),'requestHash',NEW.request_hash)
 THEN RAISE EXCEPTION 'review decision invalid' USING ERRCODE='23514';END IF;
 IF NEW.policy->>'schemaVersion' IS DISTINCT FROM '1' OR COALESCE(NEW.policy->>'minimumReviewRevision','')!~'^[1-9][0-9]*$'
 OR jsonb_typeof(NEW.policy->'requiredEvidenceCompatibility') IS DISTINCT FROM 'array'
 OR jsonb_array_length(NEW.policy->'requiredEvidenceCompatibility')=0
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.policy->'requiredEvidenceCompatibility') x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' NOT IN ('unassessed','compatible','partially_compatible','incompatible','unavailable'))
 OR jsonb_typeof(NEW.policy->'allowIneligibleApproval') IS DISTINCT FROM 'boolean'
 THEN RAISE EXCEPTION 'review policy invalid' USING ERRCODE='23514';END IF;
 IF NEW.action='approve' AND (NEW.evidence_compatibility<>'compatible' OR NOT(NEW.policy->'requiredEvidenceCompatibility' ? 'compatible') OR n<(NEW.policy->>'minimumReviewRevision')::numeric)
 THEN RAISE EXCEPTION 'review approval conditions invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER discovery_review_insert_guard BEFORE INSERT ON discovery_review_decisions FOR EACH ROW EXECUTE FUNCTION orbit_discovery_review_guard();
CREATE TRIGGER discovery_review_immutable BEFORE UPDATE OR DELETE ON discovery_review_decisions FOR EACH ROW EXECUTE FUNCTION orbit_context_evidence_immutable();
CREATE TRIGGER discovery_review_no_truncate BEFORE TRUNCATE ON discovery_review_decisions FOR EACH STATEMENT EXECUTE FUNCTION orbit_context_evidence_immutable();
COMMENT ON TABLE discovery_review_decisions IS 'Append-only editorial history; retention requires explicit authorized administrative policy, no automatic deletion. Attributed reviewer is not authenticated. Evidence and policy are historical inputs, never durable publication eligibility. Owners/superusers can bypass triggers; host authorization remains required.';
