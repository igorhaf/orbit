ALTER TABLE suinda_privacy_account_targets
  DROP CONSTRAINT IF EXISTS suinda_privacy_account_targets_field_name_check;
ALTER TABLE suinda_privacy_account_targets
  ADD CONSTRAINT suinda_privacy_account_targets_field_name_check
  CHECK(field_name IN ('name','email','avatar_url','preferences','password_hash','social_identities'));

ALTER TABLE suinda_privacy_restore_targets
  DROP CONSTRAINT IF EXISTS suinda_privacy_restore_targets_account_field_check;
ALTER TABLE suinda_privacy_restore_targets
  ADD CONSTRAINT suinda_privacy_restore_targets_account_field_check
  CHECK(account_field IN ('name','email','avatar_url','preferences','password_hash','social_identities'));

CREATE OR REPLACE FUNCTION suinda_privacy_guard_account_redaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation uuid; restore_operation uuid; allowed text[]; expected_name text; expected_email text;
  expected_avatar text; expected_preferences jsonb; expected_password_hash text; expected_mfa boolean;
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
      OR NEW.mfa_enabled IS DISTINCT FROM OLD.mfa_enabled OR NEW.disabled IS DISTINCT FROM OLD.disabled
      OR NEW.email_verified IS DISTINCT FROM OLD.email_verified OR NEW.session_version IS DISTINCT FROM OLD.session_version+1 THEN
      RAISE EXCEPTION 'Session revocation changed account data without an approved mapping';
    END IF;
    RETURN NEW;
  END IF;
  expected_name := CASE WHEN 'name'=ANY(allowed) THEN 'Dados anonimizados' ELSE OLD.name END;
  expected_email := CASE WHEN 'email'=ANY(allowed) THEN 'anon+'||OLD.id::text||'@privacy.invalid' ELSE OLD.email END;
  expected_avatar := CASE WHEN 'avatar_url'=ANY(allowed) THEN NULL ELSE OLD.avatar_url END;
  expected_preferences := CASE WHEN 'preferences'=ANY(allowed) THEN '{}'::jsonb ELSE OLD.preferences END;
  expected_password_hash := CASE WHEN 'password_hash'=ANY(allowed) THEN '!erased:'||OLD.id::text ELSE OLD.password_hash END;
  expected_mfa := CASE WHEN 'password_hash'=ANY(allowed) THEN false ELSE OLD.mfa_enabled END;
  IF NEW.name IS DISTINCT FROM expected_name OR NEW.email IS DISTINCT FROM expected_email
    OR NEW.avatar_url IS DISTINCT FROM expected_avatar OR NEW.preferences IS DISTINCT FROM expected_preferences
    OR NEW.password_hash IS DISTINCT FROM expected_password_hash OR NEW.mfa_enabled IS DISTINCT FROM expected_mfa
    OR NEW.email_verified IS DISTINCT FROM (CASE WHEN 'email'=ANY(allowed) THEN false ELSE OLD.email_verified END)
    OR NEW.disabled IS DISTINCT FROM true OR NEW.session_version IS DISTINCT FROM OLD.session_version+1 THEN
    RAISE EXCEPTION 'Account change exceeds approved privacy fields or revocation requirements';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION suinda_privacy_guard_social_identity_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation uuid; restore_operation uuid;
BEGIN
  BEGIN operation := current_setting('suinda.privacy_execution_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN operation := NULL; END;
  BEGIN restore_operation := current_setting('suinda.privacy_restore_execution_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN restore_operation := NULL; END;
  IF TG_OP='DELETE' AND operation IS NOT NULL AND EXISTS(
    SELECT 1 FROM suinda_privacy_erasures e JOIN suinda_privacy_account_targets t ON t.operation_id=e.id
    WHERE e.id=operation AND e.state='executing' AND t.subject_user_id=OLD.user_id AND t.field_name='social_identities'
  ) THEN RETURN OLD; END IF;
  IF TG_OP='DELETE' AND restore_operation IS NOT NULL AND EXISTS(
    SELECT 1 FROM suinda_privacy_restore_targets t
    WHERE t.operation_id=restore_operation AND t.subject_user_id=OLD.user_id AND t.account_field='social_identities'
  ) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Social identities can only be removed by an approved privacy operation';
END $$;

DROP TRIGGER IF EXISTS suinda_privacy_social_identity_delete ON auth_social_identities;
CREATE TRIGGER suinda_privacy_social_identity_delete
BEFORE DELETE ON auth_social_identities
FOR EACH ROW EXECUTE FUNCTION suinda_privacy_guard_social_identity_delete();
