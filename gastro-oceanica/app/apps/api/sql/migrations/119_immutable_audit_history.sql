CREATE TABLE immutable_audit_events (
  sequence_number bigserial PRIMARY KEY,
  source_audit_id bigint NOT NULL UNIQUE REFERENCES access_audit(id) ON DELETE RESTRICT,
  previous_hash text NOT NULL,
  source_hash text NOT NULL,
  event_hash text NOT NULL,
  CHECK(previous_hash ~ '^[a-f0-9]{64}$' AND source_hash ~ '^[a-f0-9]{64}$' AND event_hash ~ '^[a-f0-9]{64}$')
);

CREATE FUNCTION capture_immutable_audit_event() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE previous text; source text; sequence bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(72641026);
  SELECT event_hash INTO previous FROM immutable_audit_events ORDER BY sequence_number DESC LIMIT 1;
  previous:=COALESCE(previous,repeat('0',64));
  sequence:=nextval(pg_get_serial_sequence('immutable_audit_events','sequence_number'));
  source:=encode(sha256(convert_to(jsonb_build_array(NEW.id,NEW.actor_id,NEW.action,NEW.target,NEW.scope_type,NEW.scope_id,NEW.created_at)::text,'UTF8')),'hex');
  INSERT INTO immutable_audit_events(sequence_number,source_audit_id,previous_hash,source_hash,event_hash)
  VALUES(sequence,NEW.id,previous,source,encode(sha256(convert_to(jsonb_build_array('orbit-audit-v1',sequence,source,previous)::text,'UTF8')),'hex'));
  RETURN NEW;
END $$;
CREATE TRIGGER capture_immutable_audit AFTER INSERT ON access_audit FOR EACH ROW EXECUTE FUNCTION capture_immutable_audit_event();

CREATE FUNCTION reject_direct_audit_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth()<2 THEN RAISE EXCEPTION 'History must originate from an audited action'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audited_insert_only BEFORE INSERT ON immutable_audit_events FOR EACH ROW EXECUTE FUNCTION reject_direct_audit_history();
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON immutable_audit_events FOR EACH ROW EXECUTE FUNCTION extension_reject_history_mutation();
CREATE TRIGGER immutable_table BEFORE TRUNCATE ON immutable_audit_events FOR EACH STATEMENT EXECUTE FUNCTION extension_reject_history_mutation();

CREATE FUNCTION protect_immutable_audit_source() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM immutable_audit_events WHERE source_audit_id=OLD.id) THEN
    RAISE EXCEPTION 'Audit source protected by immutable history';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_audit_source BEFORE UPDATE OR DELETE ON access_audit FOR EACH ROW EXECUTE FUNCTION protect_immutable_audit_source();
CREATE TRIGGER immutable_audit_source_table BEFORE TRUNCATE ON access_audit FOR EACH STATEMENT EXECUTE FUNCTION extension_reject_history_mutation();
