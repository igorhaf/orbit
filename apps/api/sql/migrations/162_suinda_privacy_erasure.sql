-- Strict execution ledger for manually approved Suindá privacy actions.
-- It stores no plaintext verification code or copied personal-data values.
CREATE TABLE suinda_privacy_identity_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  request_record_id uuid NOT NULL REFERENCES extension_records(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  session_version integer NOT NULL,
  code_hash text NOT NULL CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(request_record_id,workspace_id) REFERENCES extension_records(id,workspace_id) ON DELETE RESTRICT
);
CREATE INDEX suinda_privacy_challenges_active_idx
  ON suinda_privacy_identity_challenges(user_id,request_record_id,created_at DESC)
  WHERE consumed_at IS NULL;

CREATE TABLE suinda_privacy_category_decisions (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  request_record_id uuid NOT NULL REFERENCES extension_records(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK(length(trim(category)) BETWEEN 1 AND 120),
  decision text NOT NULL CHECK(decision IN ('approved','denied')),
  legal_basis text NOT NULL CHECK(length(trim(legal_basis)) BETWEEN 1 AND 120),
  decision_reference text NOT NULL CHECK(length(trim(decision_reference)) BETWEEN 1 AND 500),
  mapping jsonb NOT NULL CHECK(jsonb_typeof(mapping)='array'),
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(request_record_id,workspace_id) REFERENCES extension_records(id,workspace_id) ON DELETE RESTRICT
);
CREATE INDEX suinda_privacy_category_decisions_latest
  ON suinda_privacy_category_decisions(request_record_id,category,created_at DESC,id DESC);

CREATE TABLE suinda_privacy_erasures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  request_record_id uuid NOT NULL REFERENCES extension_records(id) ON DELETE RESTRICT,
  subject_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_categories jsonb NOT NULL CHECK (jsonb_typeof(approved_categories)='array'),
  policy_snapshot jsonb NOT NULL CHECK (jsonb_typeof(policy_snapshot)='object'),
  operation_key uuid NOT NULL,
  state text NOT NULL CHECK(state IN ('prepared','executing','completed','blocked')),
  external_ledger_state text NOT NULL DEFAULT 'prepared' CHECK(external_ledger_state IN ('prepared','committed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(result)='object'),
  initiated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,request_record_id,operation_key),
  FOREIGN KEY(request_record_id,workspace_id) REFERENCES extension_records(id,workspace_id) ON DELETE RESTRICT
);

-- Restore uses the same narrow path allowlist as live execution. The GUC and
-- operation UUID scope staged locators to one isolated restore transaction.
CREATE TABLE suinda_privacy_restore_targets (
  id bigserial PRIMARY KEY,
  operation_id uuid NOT NULL,
  subject_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  record_id uuid REFERENCES extension_records(id) ON DELETE RESTRICT,
  revision integer,
  field_path text[],
  attachment_store text CHECK(attachment_store IN ('record_attachment','extension_file')),
  attachment_id uuid,
  account_field text CHECK(account_field IN ('name','email','avatar_url','preferences')),
  CHECK (
    (subject_user_id IS NOT NULL AND record_id IS NULL AND revision IS NULL AND field_path IS NULL AND attachment_store IS NULL AND attachment_id IS NULL)
    OR (subject_user_id IS NULL AND record_id IS NOT NULL AND revision IS NOT NULL AND revision>0 AND field_path IS NOT NULL AND cardinality(field_path)>0 AND attachment_store IS NULL AND attachment_id IS NULL AND account_field IS NULL)
    OR (subject_user_id IS NULL AND record_id IS NOT NULL AND revision IS NOT NULL AND revision>0 AND field_path IS NULL AND attachment_store='record_attachment' AND attachment_id IS NOT NULL AND account_field IS NULL)
    OR (subject_user_id IS NULL AND record_id IS NOT NULL AND revision IS NOT NULL AND revision>0 AND field_path IS NULL AND attachment_store='extension_file' AND attachment_id IS NULL AND account_field IS NULL)
  ),
  FOREIGN KEY(record_id,revision) REFERENCES extension_record_versions(record_id,revision) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX suinda_privacy_restore_field_uq ON suinda_privacy_restore_targets(operation_id,record_id,revision,field_path) WHERE field_path IS NOT NULL;
CREATE UNIQUE INDEX suinda_privacy_restore_attachment_uq ON suinda_privacy_restore_targets(operation_id,record_id,revision,attachment_store,COALESCE(attachment_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE attachment_store IS NOT NULL;
CREATE UNIQUE INDEX suinda_privacy_restore_account_uq ON suinda_privacy_restore_targets(operation_id,subject_user_id,COALESCE(account_field,'')) WHERE subject_user_id IS NOT NULL;

CREATE FUNCTION suinda_privacy_guard_restore_target_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation uuid;
BEGIN
  BEGIN operation := current_setting('suinda.privacy_restore_execution_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN operation := NULL; END;
  IF operation IS NULL OR NEW.operation_id IS DISTINCT FROM operation THEN
    RAISE EXCEPTION 'Restore targets require their transaction-scoped operation context';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER suinda_privacy_restore_target_context
BEFORE INSERT ON suinda_privacy_restore_targets
FOR EACH ROW EXECUTE FUNCTION suinda_privacy_guard_restore_target_insert();

CREATE TABLE suinda_privacy_execution_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  request_record_id uuid NOT NULL REFERENCES extension_records(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK(state='blocked'),
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(request_record_id,workspace_id) REFERENCES extension_records(id,workspace_id) ON DELETE RESTRICT
);
CREATE INDEX suinda_privacy_execution_attempts_latest ON suinda_privacy_execution_attempts(request_record_id,created_at DESC,id DESC);

-- Every changed historic payload path or attachment must be explicitly staged
-- for this operation. This prevents broad trigger bypasses and keeps the audit
-- chain itself immutable.
CREATE TABLE suinda_privacy_erasure_targets (
  id bigserial PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES suinda_privacy_erasures(id) ON DELETE RESTRICT,
  record_id uuid NOT NULL REFERENCES extension_records(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  category text NOT NULL,
  field_path text[],
  attachment_id uuid,
  attachment_store text NOT NULL DEFAULT 'record_attachment' CHECK(attachment_store IN ('record_attachment','extension_file')),
  FOREIGN KEY(record_id,revision) REFERENCES extension_record_versions(record_id,revision) ON DELETE RESTRICT,
  CHECK ((field_path IS NOT NULL)::int + (attachment_id IS NOT NULL)::int = 1),
  CHECK (field_path IS NOT NULL OR attachment_id IS NOT NULL)
);
CREATE UNIQUE INDEX suinda_privacy_erasure_field_target_uq
  ON suinda_privacy_erasure_targets(operation_id,record_id,revision,category,field_path) WHERE field_path IS NOT NULL;
CREATE UNIQUE INDEX suinda_privacy_erasure_attachment_target_uq
  ON suinda_privacy_erasure_targets(operation_id,record_id,revision,category,attachment_store,attachment_id) WHERE attachment_id IS NOT NULL;

CREATE TABLE suinda_privacy_account_targets (
  operation_id uuid NOT NULL REFERENCES suinda_privacy_erasures(id) ON DELETE RESTRICT,
  subject_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category text NOT NULL,
  field_name text NOT NULL CHECK(field_name IN ('name','email','avatar_url','preferences')),
  PRIMARY KEY(operation_id,subject_user_id,category,field_name)
);

CREATE OR REPLACE FUNCTION extension_reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation uuid; restore_operation uuid;
BEGIN
  IF TG_OP='UPDATE' AND TG_TABLE_NAME IN ('extension_record_versions','extension_files','immutable_audit_events') THEN
    BEGIN operation := current_setting('suinda.privacy_execution_id',true)::uuid;
    EXCEPTION WHEN OTHERS THEN operation := NULL; END;
    IF operation IS NOT NULL AND TG_TABLE_NAME='extension_record_versions' AND EXISTS(
      SELECT 1 FROM suinda_privacy_erasures e JOIN suinda_privacy_erasure_targets t ON t.operation_id=e.id
      WHERE e.id=operation AND e.state='executing' AND t.record_id=OLD.record_id AND t.revision=OLD.revision AND t.field_path IS NOT NULL
    ) THEN RETURN NEW; END IF;
    IF operation IS NOT NULL AND TG_TABLE_NAME='extension_files' AND EXISTS(
      SELECT 1 FROM suinda_privacy_erasures e JOIN suinda_privacy_erasure_targets t ON t.operation_id=e.id
      WHERE e.id=operation AND e.state='executing' AND t.record_id=OLD.record_id AND t.revision=OLD.revision AND t.attachment_store='extension_file'
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

CREATE OR REPLACE FUNCTION extension_reject_attachment_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation uuid; restore_operation uuid;
BEGIN
  IF TG_OP='UPDATE' THEN
    BEGIN operation := current_setting('suinda.privacy_execution_id',true)::uuid;
    EXCEPTION WHEN OTHERS THEN operation := NULL; END;
    IF operation IS NOT NULL AND EXISTS(
      SELECT 1 FROM suinda_privacy_erasures e JOIN suinda_privacy_erasure_targets t ON t.operation_id=e.id
      WHERE e.id=operation AND e.state='executing' AND t.record_id=OLD.record_id AND t.revision=OLD.revision
        AND t.attachment_store='record_attachment' AND t.attachment_id=OLD.id
    ) THEN RETURN NEW; END IF;
    BEGIN restore_operation := current_setting('suinda.privacy_restore_execution_id',true)::uuid;
    EXCEPTION WHEN OTHERS THEN restore_operation := NULL; END;
    IF restore_operation IS NOT NULL AND EXISTS(SELECT 1 FROM suinda_privacy_restore_targets t
      WHERE t.operation_id=restore_operation AND t.record_id=OLD.record_id AND t.revision=OLD.revision
        AND t.attachment_store='record_attachment' AND t.attachment_id=OLD.id) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Record attachments are append-only';
END $$;

CREATE TRIGGER suinda_privacy_restore_targets_immutable
BEFORE UPDATE OR DELETE ON suinda_privacy_restore_targets
FOR EACH ROW EXECUTE FUNCTION extension_reject_history_mutation();

CREATE FUNCTION suinda_privacy_redact_path(source jsonb, path text[]) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result jsonb; parent_path text[]; i integer;
BEGIN
  IF cardinality(path)=0 THEN RAISE EXCEPTION 'Empty privacy redaction path'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(path) AS segment WHERE segment ~ '^[0-9]+$') THEN
    RAISE EXCEPTION 'Array indexes are not supported in privacy redaction paths';
  END IF;
  parent_path := path[1:cardinality(path)-1];
  FOR i IN 1..cardinality(parent_path) LOOP
    IF jsonb_typeof(source #> parent_path[1:i]) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Privacy redaction path traverses a missing or non-object value';
    END IF;
  END LOOP;
  IF source #> path IS NULL THEN RAISE EXCEPTION 'Privacy redaction path does not exist'; END IF;
  IF jsonb_typeof(source #> path) IN ('object','array') THEN RAISE EXCEPTION 'Privacy redaction path must target one scalar leaf'; END IF;
  result := source #- path;
  RETURN result;
END $$;

CREATE FUNCTION suinda_privacy_redact_path_if_present(source jsonb, path text[]) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
  IF source #> path IS NULL THEN RETURN source; END IF;
  RETURN suinda_privacy_redact_path(source,path);
END $$;

CREATE FUNCTION suinda_privacy_paths_overlap(left_path jsonb, right_path jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE left_parts text[]; right_parts text[];
BEGIN
  left_parts := ARRAY(SELECT jsonb_array_elements_text(left_path));
  right_parts := ARRAY(SELECT jsonb_array_elements_text(right_path));
  IF left_parts=right_parts THEN RETURN false; END IF;
  RETURN (cardinality(left_parts)<=cardinality(right_parts) AND right_parts[1:cardinality(left_parts)]=left_parts)
      OR (cardinality(right_parts)<=cardinality(left_parts) AND left_parts[1:cardinality(right_parts)]=right_parts);
END $$;

CREATE FUNCTION suinda_privacy_guard_version_redaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation uuid; restore_operation uuid; paths jsonb; path_json jsonb; path text[]; expected jsonb;
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.record_id IS DISTINCT FROM OLD.record_id OR NEW.revision IS DISTINCT FROM OLD.revision
    OR NEW.title IS DISTINCT FROM OLD.title OR NEW.state IS DISTINCT FROM OLD.state OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Suindá privacy execution may only redact mapped payload paths';
  END IF;
  BEGIN operation := current_setting('suinda.privacy_execution_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN operation := NULL; END;
  BEGIN restore_operation := current_setting('suinda.privacy_restore_execution_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN restore_operation := NULL; END;
  IF operation IS NULL AND restore_operation IS NULL THEN RETURN NEW; END IF;
  IF (operation IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM suinda_privacy_erasures e WHERE e.id=operation AND e.state='executing'
      AND EXISTS(SELECT 1 FROM suinda_privacy_erasure_targets t
        WHERE t.operation_id=e.id AND t.record_id=OLD.record_id AND t.revision=OLD.revision AND t.field_path IS NOT NULL)
  )) OR (operation IS NULL AND NOT EXISTS(SELECT 1 FROM suinda_privacy_restore_targets t
    WHERE t.operation_id=restore_operation AND t.record_id=OLD.record_id AND t.revision=OLD.revision AND t.field_path IS NOT NULL))
    THEN RAISE EXCEPTION 'No authorized Suindá privacy redaction context'; END IF;
  IF operation IS NOT NULL THEN
    SELECT jsonb_agg(to_jsonb(t.field_path)) INTO paths FROM suinda_privacy_erasure_targets t
      WHERE t.operation_id=operation AND t.record_id=OLD.record_id AND t.revision=OLD.revision AND t.field_path IS NOT NULL;
  ELSE
    SELECT jsonb_agg(to_jsonb(t.field_path)) INTO paths FROM suinda_privacy_restore_targets t
      WHERE t.operation_id=restore_operation AND t.record_id=OLD.record_id AND t.revision=OLD.revision AND t.field_path IS NOT NULL;
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
  RETURN NEW;
END $$;

CREATE TRIGGER suinda_privacy_version_redaction
BEFORE UPDATE ON extension_record_versions
FOR EACH ROW EXECUTE FUNCTION suinda_privacy_guard_version_redaction();

CREATE FUNCTION suinda_privacy_guard_current_record_redaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation uuid; restore_operation uuid; paths jsonb; path_json jsonb; path text[]; expected jsonb;
BEGIN
  IF TG_OP<>'UPDATE' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.plugin_id IS DISTINCT FROM OLD.plugin_id
    OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.title IS DISTINCT FROM OLD.title OR NEW.state IS DISTINCT FROM OLD.state OR NEW.revision IS DISTINCT FROM OLD.revision
    OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN
    RAISE EXCEPTION 'Suindá privacy execution may only redact mapped current payload paths';
  END IF;
  BEGIN operation := current_setting('suinda.privacy_execution_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN operation := NULL; END;
  BEGIN restore_operation := current_setting('suinda.privacy_restore_execution_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN restore_operation := NULL; END;
  IF operation IS NULL AND restore_operation IS NULL THEN RETURN NEW; END IF;
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
CREATE TRIGGER suinda_privacy_current_redaction
BEFORE UPDATE ON extension_records
FOR EACH ROW EXECUTE FUNCTION suinda_privacy_guard_current_record_redaction();

CREATE FUNCTION suinda_privacy_guard_attachment_redaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation uuid; restore_operation uuid;
BEGIN
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
CREATE TRIGGER suinda_privacy_attachment_redaction
BEFORE UPDATE ON extension_record_attachments
FOR EACH ROW EXECUTE FUNCTION suinda_privacy_guard_attachment_redaction();

CREATE FUNCTION suinda_privacy_guard_extension_file_redaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation uuid; restore_operation uuid;
BEGIN
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
CREATE TRIGGER suinda_privacy_extension_file_redaction
BEFORE UPDATE ON extension_files
FOR EACH ROW EXECUTE FUNCTION suinda_privacy_guard_extension_file_redaction();

CREATE FUNCTION suinda_privacy_guard_account_redaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation uuid; restore_operation uuid; allowed text[]; expected_name text; expected_email text; expected_avatar text; expected_preferences jsonb;
BEGIN
  BEGIN operation := current_setting('suinda.privacy_execution_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN operation := NULL; END;
  BEGIN restore_operation := current_setting('suinda.privacy_restore_execution_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN restore_operation := NULL; END;
  IF operation IS NULL AND restore_operation IS NULL THEN RETURN NEW; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.is_root IS DISTINCT FROM OLD.is_root OR OLD.is_root
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'ROOT and account identity metadata are protected';
  END IF;
  IF operation IS NOT NULL THEN
    SELECT array_agg(field_name) INTO allowed FROM suinda_privacy_account_targets
      WHERE operation_id=operation AND subject_user_id=OLD.id;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM suinda_privacy_restore_targets WHERE operation_id=restore_operation AND subject_user_id=OLD.id)
      THEN RAISE EXCEPTION 'No authorized Suindá account restore context'; END IF;
    SELECT array_agg(account_field) INTO allowed FROM suinda_privacy_restore_targets
      WHERE operation_id=restore_operation AND subject_user_id=OLD.id AND account_field IS NOT NULL;
  END IF;
  IF allowed IS NULL THEN
    IF NEW.name IS DISTINCT FROM OLD.name OR NEW.email IS DISTINCT FROM OLD.email OR NEW.password_hash IS DISTINCT FROM OLD.password_hash
      OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url OR NEW.preferences IS DISTINCT FROM OLD.preferences
      OR NEW.disabled IS DISTINCT FROM OLD.disabled OR NEW.email_verified IS DISTINCT FROM OLD.email_verified
      OR NEW.session_version IS DISTINCT FROM OLD.session_version+1 THEN
      RAISE EXCEPTION 'Session revocation changed account data without an approved mapping';
    END IF;
    RETURN NEW;
  END IF;
  expected_name := CASE WHEN 'name'=ANY(allowed) THEN 'Dados anonimizados' ELSE OLD.name END;
  expected_email := CASE WHEN 'email'=ANY(allowed) THEN 'anon+'||OLD.id::text||'@privacy.invalid' ELSE OLD.email END;
  expected_avatar := CASE WHEN 'avatar_url'=ANY(allowed) THEN NULL ELSE OLD.avatar_url END;
  expected_preferences := CASE WHEN 'preferences'=ANY(allowed) THEN '{}'::jsonb ELSE OLD.preferences END;
  IF NEW.name IS DISTINCT FROM expected_name OR NEW.email IS DISTINCT FROM expected_email
    OR NEW.avatar_url IS DISTINCT FROM expected_avatar OR NEW.preferences IS DISTINCT FROM expected_preferences
    OR NEW.password_hash IS DISTINCT FROM OLD.password_hash
    OR NEW.email_verified IS DISTINCT FROM (CASE WHEN 'email'=ANY(allowed) THEN false ELSE OLD.email_verified END)
    OR NEW.disabled IS DISTINCT FROM true OR NEW.session_version IS DISTINCT FROM OLD.session_version+1 THEN
    RAISE EXCEPTION 'Account change exceeds approved privacy fields or revocation requirements';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER suinda_privacy_account_redaction
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION suinda_privacy_guard_account_redaction();

CREATE TRIGGER suinda_privacy_erasures_immutable
BEFORE UPDATE OR DELETE ON suinda_privacy_erasure_targets
FOR EACH ROW EXECUTE FUNCTION extension_reject_history_mutation();

CREATE TRIGGER suinda_privacy_decisions_immutable
BEFORE UPDATE OR DELETE ON suinda_privacy_category_decisions
FOR EACH ROW EXECUTE FUNCTION extension_reject_history_mutation();
CREATE TRIGGER suinda_privacy_account_targets_immutable
BEFORE UPDATE OR DELETE ON suinda_privacy_account_targets
FOR EACH ROW EXECUTE FUNCTION extension_reject_history_mutation();
CREATE TRIGGER suinda_privacy_execution_attempts_immutable
BEFORE UPDATE OR DELETE ON suinda_privacy_execution_attempts
FOR EACH ROW EXECUTE FUNCTION extension_reject_history_mutation();

CREATE FUNCTION suinda_privacy_guard_erasure_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Suindá erasure ledger cannot be deleted'; END IF;
  IF OLD.state IS DISTINCT FROM 'executing' OR NEW.state IS DISTINCT FROM 'completed'
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.request_record_id IS DISTINCT FROM OLD.request_record_id OR NEW.subject_user_id IS DISTINCT FROM OLD.subject_user_id
    OR NEW.approved_categories IS DISTINCT FROM OLD.approved_categories OR NEW.policy_snapshot IS DISTINCT FROM OLD.policy_snapshot
    OR NEW.operation_key IS DISTINCT FROM OLD.operation_key OR NEW.initiated_by IS DISTINCT FROM OLD.initiated_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.external_ledger_state IS DISTINCT FROM 'prepared'
    OR NEW.result IS NULL OR NEW.completed_at IS NULL THEN
    IF OLD.state='completed' AND NEW.state='completed'
      AND OLD.external_ledger_state='prepared' AND NEW.external_ledger_state='committed'
      AND NEW.id IS NOT DISTINCT FROM OLD.id AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id
      AND NEW.request_record_id IS NOT DISTINCT FROM OLD.request_record_id AND NEW.subject_user_id IS NOT DISTINCT FROM OLD.subject_user_id
      AND NEW.approved_categories IS NOT DISTINCT FROM OLD.approved_categories AND NEW.policy_snapshot IS NOT DISTINCT FROM OLD.policy_snapshot
      AND NEW.operation_key IS NOT DISTINCT FROM OLD.operation_key AND NEW.initiated_by IS NOT DISTINCT FROM OLD.initiated_by
      AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at AND NEW.result IS NOT DISTINCT FROM OLD.result
      AND NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Suindá erasure ledger is append-only except for completion and external-ledger confirmation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER suinda_privacy_erasure_ledger_guard
BEFORE UPDATE OR DELETE ON suinda_privacy_erasures
FOR EACH ROW EXECUTE FUNCTION suinda_privacy_guard_erasure_ledger();

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['suinda_privacy_erasures','suinda_privacy_erasure_targets','suinda_privacy_account_targets','suinda_privacy_category_decisions','suinda_privacy_execution_attempts','suinda_privacy_restore_targets'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION extension_reject_history_mutation()',table_name||'_no_truncate',table_name);
  END LOOP;
END $$;
