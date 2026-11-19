-- Base demand revision only. Related records, comments, checklists, attachments,
-- execution-config rows and project context require a later context fingerprint.
ALTER TABLE cards ADD COLUMN card_revision integer NOT NULL DEFAULT 1 CHECK (card_revision > 0);
CREATE TABLE card_revisions (
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (card_id, revision)
);

-- Normalize timestamps even when to_jsonb(card) was evaluated in another zone.
CREATE FUNCTION orbit_card_revision_snapshot(document jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET TimeZone = 'UTC' AS $$
  SELECT jsonb_build_object(
    'schema_version', 1,
    'title', document->'title',
    'description', document->'description',
    'kind', document->'kind',
    'target_board_id', document->'target_board_id',
    'link_url', document->'link_url',
    'ai_project_id', document->'ai_project_id',
    'ai_model', document->'ai_model',
    'ai_effort', document->'ai_effort',
    'ai_execution_mode', document->'ai_execution_mode',
    'start_date', to_char((document->>'start_date')::timestamptz, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'due_date', to_char((document->>'due_date')::timestamptz, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'reminder_minutes', document->'reminder_minutes',
    'recurrence', document->'recurrence',
    'schedule_start_at', to_char((document->>'schedule_start_at')::timestamptz, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'schedule_end_at', to_char((document->>'schedule_end_at')::timestamptz, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'schedule_all_day', document->'schedule_all_day',
    'schedule_time_zone', document->'schedule_time_zone'
  );
$$;

-- Baseline represents the state observed at migration, never historical states.
INSERT INTO card_revisions(card_id, revision, snapshot, content_hash)
SELECT c.id, c.card_revision, payload.snapshot,
       encode(sha256(convert_to(payload.snapshot::text, 'UTF8')), 'hex')
FROM cards c CROSS JOIN LATERAL (SELECT orbit_card_revision_snapshot(to_jsonb(c)) AS snapshot) payload;

CREATE FUNCTION orbit_advance_card_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.card_revision IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'A new card must start at revision 1' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.card_revision IS DISTINCT FROM OLD.card_revision THEN
      RAISE EXCEPTION 'Card revision is managed by Orbit Core' USING ERRCODE = '23514';
    END IF;
    IF orbit_card_revision_snapshot(to_jsonb(NEW)) IS DISTINCT FROM orbit_card_revision_snapshot(to_jsonb(OLD)) THEN
      NEW.card_revision := OLD.card_revision + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER orbit_advance_card_revision BEFORE INSERT OR UPDATE ON cards
FOR EACH ROW EXECUTE FUNCTION orbit_advance_card_revision();

CREATE FUNCTION orbit_capture_card_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE payload jsonb;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.card_revision IS DISTINCT FROM OLD.card_revision THEN
    payload := orbit_card_revision_snapshot(to_jsonb(NEW));
    INSERT INTO card_revisions(card_id, revision, snapshot, content_hash)
    VALUES (NEW.id, NEW.card_revision, payload,
            encode(sha256(convert_to(payload::text, 'UTF8')), 'hex'));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER orbit_capture_card_revision AFTER INSERT OR UPDATE ON cards
FOR EACH ROW EXECUTE FUNCTION orbit_capture_card_revision();

-- Protect application-level history, while retaining the existing card deletion
-- cascade. Database owners can alter triggers; this is not a security sandbox.
CREATE FUNCTION orbit_protect_card_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Card revision snapshots are immutable' USING ERRCODE = '23514';
  ELSIF TG_OP = 'INSERT' THEN
    IF pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'Card revisions can only be created by the card trigger' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  ELSIF EXISTS (SELECT 1 FROM cards WHERE id = OLD.card_id) THEN
    RAISE EXCEPTION 'Card revisions can only be deleted with their card' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER orbit_protect_card_revision BEFORE INSERT OR UPDATE OR DELETE ON card_revisions
FOR EACH ROW EXECUTE FUNCTION orbit_protect_card_revision();

-- Existing runs remain NULL: there is no evidence of their historical revision.
ALTER TABLE card_runs ADD COLUMN card_revision integer;
ALTER TABLE card_ai_runs ADD COLUMN card_revision integer;
ALTER TABLE card_runs ADD COLUMN finished_card_revision integer CHECK (finished_card_revision > 0);
ALTER TABLE card_ai_runs ADD COLUMN finished_card_revision integer CHECK (finished_card_revision > 0);
ALTER TABLE card_runs ADD CONSTRAINT card_runs_card_revision_fk
  FOREIGN KEY(card_id, card_revision) REFERENCES card_revisions(card_id, revision) ON DELETE CASCADE;
ALTER TABLE card_ai_runs ADD CONSTRAINT card_ai_runs_card_revision_fk
  FOREIGN KEY(card_id, card_revision) REFERENCES card_revisions(card_id, revision) ON DELETE CASCADE;

CREATE FUNCTION orbit_bind_run_card_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE current_revision integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.card_id IS DISTINCT FROM OLD.card_id OR NEW.card_revision IS DISTINCT FROM OLD.card_revision THEN
      RAISE EXCEPTION 'A run cannot change its captured card revision' USING ERRCODE = '23514';
    END IF;
    IF NEW.finished_card_revision IS DISTINCT FROM OLD.finished_card_revision THEN
      RAISE EXCEPTION 'The completion revision is managed by Orbit Core' USING ERRCODE = '23514';
    END IF;
    IF NEW.status IN ('success','failed','error','cancelled') AND OLD.status NOT IN ('success','failed','error','cancelled') THEN
      SELECT card_revision INTO current_revision FROM cards WHERE id = NEW.card_id FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Card no longer exists at run completion' USING ERRCODE = '23503';
      END IF;
      NEW.finished_card_revision := current_revision;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.finished_card_revision IS NOT NULL THEN
    RAISE EXCEPTION 'The completion revision is managed by Orbit Core' USING ERRCODE = '23514';
  END IF;
  IF NEW.card_revision IS NULL THEN
    RAISE EXCEPTION 'A new run must capture its card revision' USING ERRCODE = '23514';
  END IF;
  -- SHARE conflicts with card updates for the enclosing enqueue transaction.
  SELECT card_revision INTO current_revision FROM cards WHERE id = NEW.card_id FOR SHARE;
  IF NOT FOUND OR NEW.card_revision IS DISTINCT FROM current_revision THEN
    RAISE EXCEPTION 'Card changed while the run was being prepared; enqueue again' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('success','failed','error','cancelled') THEN
    NEW.finished_card_revision := current_revision;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER orbit_bind_card_run_revision BEFORE INSERT OR UPDATE ON card_runs
FOR EACH ROW EXECUTE FUNCTION orbit_bind_run_card_revision();
CREATE TRIGGER orbit_bind_card_ai_run_revision BEFORE INSERT OR UPDATE ON card_ai_runs
FOR EACH ROW EXECUTE FUNCTION orbit_bind_run_card_revision();
