CREATE OR REPLACE FUNCTION suinda_privacy_guard_current_record_redaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation uuid; restore_operation uuid; paths jsonb; path_json jsonb; path text[]; expected jsonb;
BEGIN
  BEGIN operation := current_setting('suinda.privacy_execution_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN operation := NULL; END;
  BEGIN restore_operation := current_setting('suinda.privacy_restore_execution_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN restore_operation := NULL; END;

  -- Ordinary record updates are governed by the owning plugin/service. This
  -- trigger narrows mutations only while an explicit privacy operation runs.
  IF operation IS NULL AND restore_operation IS NULL THEN RETURN NEW; END IF;
  IF operation IS NOT NULL AND restore_operation IS NOT NULL THEN
    RAISE EXCEPTION 'Conflicting Suindá privacy execution contexts';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.plugin_id IS DISTINCT FROM OLD.plugin_id
    OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.title IS DISTINCT FROM OLD.title OR NEW.state IS DISTINCT FROM OLD.state OR NEW.revision IS DISTINCT FROM OLD.revision
    OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN
    RAISE EXCEPTION 'Suindá privacy execution may only redact mapped current payload paths';
  END IF;

  IF (operation IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM suinda_privacy_erasures e JOIN suinda_privacy_erasure_targets t ON t.operation_id=e.id
      WHERE e.id=operation AND e.state='executing' AND t.record_id=OLD.id
        AND t.revision=OLD.revision AND t.field_path IS NOT NULL
  )) OR (operation IS NULL AND NOT EXISTS(SELECT 1 FROM suinda_privacy_restore_targets t
    WHERE t.operation_id=restore_operation AND t.record_id=OLD.id AND t.revision=OLD.revision AND t.field_path IS NOT NULL))
    THEN RAISE EXCEPTION 'No authorized Suindá current-record redaction context'; END IF;

  IF operation IS NOT NULL THEN
    SELECT jsonb_agg(to_jsonb(t.field_path)) INTO paths FROM suinda_privacy_erasure_targets t
      WHERE t.operation_id=operation AND t.record_id=OLD.id AND t.revision=OLD.revision AND t.field_path IS NOT NULL;
  ELSE
    SELECT jsonb_agg(to_jsonb(t.field_path)) INTO paths FROM suinda_privacy_restore_targets t
      WHERE t.operation_id=restore_operation AND t.record_id=OLD.id AND t.revision=OLD.revision AND t.field_path IS NOT NULL;
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(paths) a(path) CROSS JOIN jsonb_array_elements(paths) b(path)
    WHERE suinda_privacy_paths_overlap(a.path,b.path))
    THEN RAISE EXCEPTION 'Overlapping privacy redaction paths are ambiguous'; END IF;
  expected := OLD.payload;
  FOR path_json IN SELECT value FROM jsonb_array_elements(paths) LOOP
    path := ARRAY(SELECT jsonb_array_elements_text(path_json));
    expected := suinda_privacy_redact_path_if_present(expected,path);
  END LOOP;
  IF NEW.payload IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Payload change exceeds approved redaction paths'; END IF;
  NEW.updated_at := OLD.updated_at;
  RETURN NEW;
END $$;
