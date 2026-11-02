-- Narrow, auditable permission for the operator backfill of declared sensitive
-- record attachments. Ordinary revisions remain immutable.
CREATE TABLE orbit_attachment_encryption_targets (
  operation_id uuid NOT NULL,
  record_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision>0),
  attachment_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(operation_id,record_id,revision,attachment_id),
  FOREIGN KEY(record_id,revision,attachment_id)
    REFERENCES extension_record_attachments(record_id,revision,id) ON DELETE RESTRICT
);
CREATE INDEX orbit_attachment_encryption_targets_attachment_idx
  ON orbit_attachment_encryption_targets(record_id,revision,attachment_id);

CREATE FUNCTION orbit_guard_attachment_encryption_target_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation uuid; marker bytea;
BEGIN
  BEGIN operation := current_setting('orbit.attachment_encryption_operation_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN operation := NULL; END;
  marker := decode('00ff4f524249542d4154542d3100','hex');
  IF operation IS NULL OR NEW.operation_id IS DISTINCT FROM operation
    OR NOT EXISTS(SELECT 1 FROM extension_record_attachments a
      WHERE a.record_id=NEW.record_id AND a.revision=NEW.revision AND a.id=NEW.attachment_id
        AND substring(a.data FROM 1 FOR octet_length(marker))<>marker) THEN
    RAISE EXCEPTION 'Attachment encryption targets require the scoped backfill operation and a legacy attachment';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orbit_attachment_encryption_targets_context
  BEFORE INSERT ON orbit_attachment_encryption_targets
  FOR EACH ROW EXECUTE FUNCTION orbit_guard_attachment_encryption_target_insert();
CREATE TRIGGER orbit_attachment_encryption_targets_immutable
  BEFORE UPDATE OR DELETE ON orbit_attachment_encryption_targets
  FOR EACH ROW EXECUTE FUNCTION extension_reject_history_mutation();
CREATE TRIGGER orbit_attachment_encryption_targets_no_truncate
  BEFORE TRUNCATE ON orbit_attachment_encryption_targets
  FOR EACH STATEMENT EXECUTE FUNCTION extension_reject_history_mutation();

CREATE TABLE orbit_extension_file_encryption_targets (
  operation_id uuid NOT NULL,
  record_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(operation_id,record_id,revision),
  FOREIGN KEY(record_id,revision) REFERENCES extension_files(record_id,revision) ON DELETE RESTRICT
);
CREATE INDEX orbit_extension_file_encryption_targets_file_idx
  ON orbit_extension_file_encryption_targets(record_id,revision);

CREATE FUNCTION orbit_guard_extension_file_encryption_target_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation uuid; marker bytea;
BEGIN
  BEGIN operation := current_setting('orbit.attachment_encryption_operation_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN operation := NULL; END;
  marker := decode('00ff4f524249542d4154542d3100','hex');
  IF operation IS NULL OR NEW.operation_id IS DISTINCT FROM operation
    OR NOT EXISTS(SELECT 1 FROM extension_files f
      WHERE f.record_id=NEW.record_id AND f.revision=NEW.revision
        AND substring(f.data FROM 1 FOR octet_length(marker))<>marker) THEN
    RAISE EXCEPTION 'Extension file encryption targets require the scoped backfill operation and a legacy file';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orbit_extension_file_encryption_targets_context
  BEFORE INSERT ON orbit_extension_file_encryption_targets
  FOR EACH ROW EXECUTE FUNCTION orbit_guard_extension_file_encryption_target_insert();
CREATE TRIGGER orbit_extension_file_encryption_targets_immutable
  BEFORE UPDATE OR DELETE ON orbit_extension_file_encryption_targets
  FOR EACH ROW EXECUTE FUNCTION extension_reject_history_mutation();
CREATE TRIGGER orbit_extension_file_encryption_targets_no_truncate
  BEFORE TRUNCATE ON orbit_extension_file_encryption_targets
  FOR EACH STATEMENT EXECUTE FUNCTION extension_reject_history_mutation();

CREATE OR REPLACE FUNCTION extension_reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation uuid; restore_operation uuid; encryption_operation uuid; marker bytea;
BEGIN
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='extension_files' THEN
    marker := decode('00ff4f524249542d4154542d3100','hex');
    BEGIN encryption_operation := current_setting('orbit.attachment_encryption_operation_id',true)::uuid;
    EXCEPTION WHEN OTHERS THEN encryption_operation := NULL; END;
    IF encryption_operation IS NOT NULL
      AND NEW.record_id IS NOT DISTINCT FROM OLD.record_id AND NEW.revision IS NOT DISTINCT FROM OLD.revision
      AND NEW.sha256 IS NOT DISTINCT FROM OLD.sha256 AND NEW.uploaded_by IS NOT DISTINCT FROM OLD.uploaded_by
      AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
      AND substring(NEW.data FROM 1 FOR octet_length(marker))=marker
      AND substring(OLD.data FROM 1 FOR octet_length(marker))<>marker
      AND EXISTS(SELECT 1 FROM orbit_extension_file_encryption_targets t
        WHERE t.operation_id=encryption_operation AND t.record_id=OLD.record_id AND t.revision=OLD.revision) THEN
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND TG_TABLE_NAME IN ('extension_record_versions','extension_files','immutable_audit_events') THEN
    BEGIN operation := current_setting('suinda.privacy_execution_id',true)::uuid;
    EXCEPTION WHEN OTHERS THEN operation := NULL; END;
    IF operation IS NOT NULL AND TG_TABLE_NAME IN ('extension_record_versions','extension_files') AND EXISTS(
      SELECT 1 FROM suinda_privacy_erasures e WHERE e.id=operation AND e.state='executing'
    ) THEN RETURN NEW; END IF;
    BEGIN restore_operation := current_setting('suinda.privacy_restore_execution_id',true)::uuid;
    EXCEPTION WHEN OTHERS THEN restore_operation := NULL; END;
    IF restore_operation IS NOT NULL AND (
      (TG_TABLE_NAME='extension_record_versions' AND EXISTS(SELECT 1 FROM suinda_privacy_restore_targets t WHERE t.operation_id=restore_operation AND t.record_id=OLD.record_id AND t.revision=OLD.revision AND t.field_path IS NOT NULL))
      OR (TG_TABLE_NAME='extension_files' AND EXISTS(SELECT 1 FROM suinda_privacy_restore_targets t WHERE t.operation_id=restore_operation AND t.record_id=OLD.record_id AND t.revision=OLD.revision AND t.attachment_store='extension_file'))
    ) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Extension history is append-only; create a new version';
END $$;

CREATE OR REPLACE FUNCTION suinda_privacy_guard_extension_file_redaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation uuid; restore_operation uuid; encryption_operation uuid; marker bytea;
BEGIN
  marker := decode('00ff4f524249542d4154542d3100','hex');
  BEGIN encryption_operation := current_setting('orbit.attachment_encryption_operation_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN encryption_operation := NULL; END;
  IF TG_OP='UPDATE' AND encryption_operation IS NOT NULL
    AND NEW.record_id IS NOT DISTINCT FROM OLD.record_id AND NEW.revision IS NOT DISTINCT FROM OLD.revision
    AND NEW.sha256 IS NOT DISTINCT FROM OLD.sha256 AND NEW.uploaded_by IS NOT DISTINCT FROM OLD.uploaded_by
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    AND substring(NEW.data FROM 1 FOR octet_length(marker))=marker
    AND substring(OLD.data FROM 1 FOR octet_length(marker))<>marker
    AND EXISTS(SELECT 1 FROM orbit_extension_file_encryption_targets t
      WHERE t.operation_id=encryption_operation AND t.record_id=OLD.record_id AND t.revision=OLD.revision) THEN
    RETURN NEW;
  END IF;
  IF TG_OP<>'UPDATE' OR NEW.record_id IS DISTINCT FROM OLD.record_id OR NEW.revision IS DISTINCT FROM OLD.revision
    OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by OR NEW.data IS DISTINCT FROM decode('00','hex')
    OR NEW.sha256 IS DISTINCT FROM encode(sha256(decode('00','hex')),'hex') THEN
    RAISE EXCEPTION 'Suindá privacy execution may only replace mapped legacy file content';
  END IF;
  BEGIN operation := current_setting('suinda.privacy_execution_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN operation := NULL; END;
  BEGIN restore_operation := current_setting('suinda.privacy_restore_execution_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN restore_operation := NULL; END;
  IF NOT ((operation IS NOT NULL AND EXISTS(
    SELECT 1 FROM suinda_privacy_erasures e JOIN suinda_privacy_erasure_targets t ON t.operation_id=e.id
     WHERE e.id=operation AND e.state='executing' AND t.record_id=OLD.record_id
       AND t.revision=OLD.revision AND t.attachment_store='extension_file'
  )) OR (restore_operation IS NOT NULL AND EXISTS(SELECT 1 FROM suinda_privacy_restore_targets t
    WHERE t.operation_id=restore_operation AND t.record_id=OLD.record_id AND t.revision=OLD.revision AND t.attachment_store='extension_file')))
    THEN RAISE EXCEPTION 'No authorized Suindá legacy-file redaction context'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION extension_reject_attachment_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE encryption_operation uuid; privacy_operation uuid; restore_operation uuid; marker bytea;
BEGIN
  IF TG_OP='UPDATE' THEN
    marker := decode('00ff4f524249542d4154542d3100','hex');
    BEGIN encryption_operation := current_setting('orbit.attachment_encryption_operation_id',true)::uuid;
    EXCEPTION WHEN OTHERS THEN encryption_operation := NULL; END;
    IF encryption_operation IS NOT NULL
      AND NEW.record_id IS NOT DISTINCT FROM OLD.record_id
      AND NEW.revision IS NOT DISTINCT FROM OLD.revision
      AND NEW.id IS NOT DISTINCT FROM OLD.id
      AND NEW.file_name IS NOT DISTINCT FROM OLD.file_name
      AND NEW.mime_type IS NOT DISTINCT FROM OLD.mime_type
      AND NEW.size_bytes IS NOT DISTINCT FROM OLD.size_bytes
      AND NEW.sha256 IS NOT DISTINCT FROM OLD.sha256
      AND NEW.scan_status IS NOT DISTINCT FROM OLD.scan_status
      AND NEW.uploaded_by IS NOT DISTINCT FROM OLD.uploaded_by
      AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
      AND substring(NEW.data FROM 1 FOR octet_length(marker))=marker
      AND substring(OLD.data FROM 1 FOR octet_length(marker))<>marker
      AND EXISTS(SELECT 1 FROM orbit_attachment_encryption_targets t
        WHERE t.operation_id=encryption_operation AND t.record_id=OLD.record_id
          AND t.revision=OLD.revision AND t.attachment_id=OLD.id) THEN
      RETURN NEW;
    END IF;

    BEGIN privacy_operation := current_setting('suinda.privacy_execution_id',true)::uuid;
    EXCEPTION WHEN OTHERS THEN privacy_operation := NULL; END;
    IF privacy_operation IS NOT NULL AND EXISTS(
      SELECT 1 FROM suinda_privacy_erasures e WHERE e.id=privacy_operation AND e.state='executing'
    ) THEN RETURN NEW; END IF;
    BEGIN restore_operation := current_setting('suinda.privacy_restore_execution_id',true)::uuid;
    EXCEPTION WHEN OTHERS THEN restore_operation := NULL; END;
    IF restore_operation IS NOT NULL AND EXISTS(SELECT 1 FROM suinda_privacy_restore_targets t
      WHERE t.operation_id=restore_operation AND t.record_id=OLD.record_id AND t.revision=OLD.revision
        AND t.attachment_store='record_attachment' AND t.attachment_id=OLD.id) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Record attachments are append-only';
END $$;

-- The privacy guard owns all attachment rewrites too. Permit only the exact
-- immutable metadata-preserving conversion staged by the backfill operation.
CREATE OR REPLACE FUNCTION suinda_privacy_guard_attachment_redaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation uuid; restore_operation uuid; encryption_operation uuid; marker bytea;
BEGIN
  marker := decode('00ff4f524249542d4154542d3100','hex');
  BEGIN encryption_operation := current_setting('orbit.attachment_encryption_operation_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN encryption_operation := NULL; END;
  IF TG_OP='UPDATE' AND encryption_operation IS NOT NULL
    AND NEW.record_id IS NOT DISTINCT FROM OLD.record_id AND NEW.revision IS NOT DISTINCT FROM OLD.revision
    AND NEW.id IS NOT DISTINCT FROM OLD.id AND NEW.file_name IS NOT DISTINCT FROM OLD.file_name
    AND NEW.mime_type IS NOT DISTINCT FROM OLD.mime_type AND NEW.size_bytes IS NOT DISTINCT FROM OLD.size_bytes
    AND NEW.sha256 IS NOT DISTINCT FROM OLD.sha256 AND NEW.scan_status IS NOT DISTINCT FROM OLD.scan_status
    AND NEW.uploaded_by IS NOT DISTINCT FROM OLD.uploaded_by AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    AND substring(NEW.data FROM 1 FOR octet_length(marker))=marker
    AND substring(OLD.data FROM 1 FOR octet_length(marker))<>marker
    AND EXISTS(SELECT 1 FROM orbit_attachment_encryption_targets t
      WHERE t.operation_id=encryption_operation AND t.record_id=OLD.record_id
        AND t.revision=OLD.revision AND t.attachment_id=OLD.id) THEN
    RETURN NEW;
  END IF;
  IF TG_OP <> 'UPDATE' OR NEW.record_id IS DISTINCT FROM OLD.record_id OR NEW.revision IS DISTINCT FROM OLD.revision OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.data IS DISTINCT FROM decode('00','hex') OR NEW.sha256 IS DISTINCT FROM encode(sha256(decode('00','hex')),'hex')
    OR NEW.size_bytes IS DISTINCT FROM 1 OR NEW.file_name IS DISTINCT FROM 'redacted' OR NEW.mime_type IS DISTINCT FROM 'application/octet-stream' THEN
    RAISE EXCEPTION 'Suindá privacy execution may only replace mapped attachment content';
  END IF;
  BEGIN operation := current_setting('suinda.privacy_execution_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN operation := NULL; END;
  BEGIN restore_operation := current_setting('suinda.privacy_restore_execution_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN restore_operation := NULL; END;
  IF NOT ((operation IS NOT NULL AND EXISTS(
    SELECT 1 FROM suinda_privacy_erasures e JOIN suinda_privacy_erasure_targets t ON t.operation_id=e.id
     WHERE e.id=operation AND e.state='executing' AND t.record_id=OLD.record_id
       AND t.revision=OLD.revision AND t.attachment_id=OLD.id
  )) OR (restore_operation IS NOT NULL AND EXISTS(SELECT 1 FROM suinda_privacy_restore_targets t
    WHERE t.operation_id=restore_operation AND t.record_id=OLD.record_id AND t.revision=OLD.revision
      AND t.attachment_store='record_attachment' AND t.attachment_id=OLD.id)))
    THEN RAISE EXCEPTION 'No authorized Suindá attachment redaction context'; END IF;
  RETURN NEW;
END $$;
