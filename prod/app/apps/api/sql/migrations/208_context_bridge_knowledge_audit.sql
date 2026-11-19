-- Additive07B metadata. No capability, MCP, runtime flag or migration is activated.
--207's immutable binding/event guards remain unchanged; this column avoids rewriting history.
CREATE FUNCTION orbit_context_bridge_knowledge_metadata_valid(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field text; item jsonb; found_count integer; returned_count integer; omitted_count integer;
BEGIN
  IF value IS NULL OR jsonb_typeof(value) IS DISTINCT FROM 'object'
    OR NOT (value ?& ARRAY['schemaVersion','queryHash','corpusHash','policy','found','returned','omitted','sources'])
    OR value - ARRAY['schemaVersion','queryHash','corpusHash','policy','found','returned','omitted','sources','remainingBytes'] <> '{}'::jsonb
    OR value->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(value->'queryHash') IS DISTINCT FROM 'string' OR COALESCE(value->>'queryHash','') !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(value->'corpusHash') IS DISTINCT FROM 'string' OR COALESCE(value->>'corpusHash','') !~ '^[0-9a-f]{64}$'
    OR value->>'policy' IS DISTINCT FROM 'orbit-lexical-retrieval/1'
    OR jsonb_typeof(value->'sources') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOREACH field IN ARRAY ARRAY['found','returned','omitted'] LOOP
    IF jsonb_typeof(value->field) IS DISTINCT FROM 'number' OR COALESCE(value->>field,'') !~ '^[0-9]+$' THEN RETURN false; END IF;
    IF (value->>field)::numeric > (CASE WHEN field='returned' THEN 6 ELSE 256 END) THEN RETURN false; END IF;
  END LOOP;
  IF value ? 'remainingBytes' THEN
    IF jsonb_typeof(value->'remainingBytes') IS DISTINCT FROM 'number' OR COALESCE(value->>'remainingBytes','') !~ '^[0-9]+$' THEN RETURN false; END IF;
    IF (value->>'remainingBytes')::numeric > 1000000 THEN RETURN false; END IF;
  END IF;
  found_count=(value->>'found')::integer; returned_count=(value->>'returned')::integer; omitted_count=(value->>'omitted')::integer;
  IF returned_count>found_count OR omitted_count>found_count OR jsonb_array_length(value->'sources')>returned_count
    OR returned_count>0 AND jsonb_array_length(value->'sources')=0 THEN RETURN false; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(value->'sources') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR NOT (item ?& ARRAY['sourceId','sourceIdentityHash','sourceHash','sourceVersion'])
      OR item - ARRAY['sourceId','sourceIdentityHash','sourceHash','sourceVersion'] <> '{}'::jsonb
      OR jsonb_typeof(item->'sourceId') IS DISTINCT FROM 'string' OR COALESCE(item->>'sourceId','') !~ '^[A-Za-z0-9_-]{1,160}$'
      OR jsonb_typeof(item->'sourceIdentityHash') IS DISTINCT FROM 'string' OR COALESCE(item->>'sourceIdentityHash','') !~ '^[0-9a-f]{64}$'
      OR NOT (item->'sourceHash'='null'::jsonb OR jsonb_typeof(item->'sourceHash')='string' AND item->>'sourceHash' ~ '^[0-9a-f]{64}$')
      OR NOT (item->'sourceVersion'='null'::jsonb OR jsonb_typeof(item->'sourceVersion')='string' AND (item->>'sourceVersion' ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$' OR item->>'sourceVersion' ~ '^sha256:[0-9a-f]{64}$')) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;
ALTER TABLE context_bridge_events ADD COLUMN knowledge_metadata jsonb;
ALTER TABLE context_bridge_events ADD CONSTRAINT context_bridge_knowledge_metadata_check
  CHECK (knowledge_metadata IS NULL OR (capability IS NOT DISTINCT FROM 'knowledge.search' AND orbit_context_bridge_knowledge_metadata_valid(knowledge_metadata)));
COMMENT ON COLUMN context_bridge_events.knowledge_metadata IS '07B bounded query/corpus hashes, lexical policy, counts and opaque/hashed source provenance only. No raw query, body, path, credential or claim of model consumption. Independent from the immutable207 event JSON; same append-only row guards apply.';

--07A source versions are bounded sha256:<raw document hash>. This extends only
--the lexical version syntax; existing207 rows and immutable event guards remain.
ALTER TABLE context_bridge_events DROP CONSTRAINT context_bridge_events_source_version_check;
ALTER TABLE context_bridge_events ADD CONSTRAINT context_bridge_events_source_version_check
  CHECK (source_version IS NULL OR source_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$' OR source_version ~ '^sha256:[0-9a-f]{64}$');
