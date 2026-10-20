ALTER TABLE access_audit
  ADD COLUMN scope_type text,
  ADD COLUMN scope_id uuid,
  ADD CONSTRAINT access_audit_scope_pair CHECK ((scope_type IS NULL)=(scope_id IS NULL));

CREATE INDEX access_audit_scope_created_idx ON access_audit(scope_type,scope_id,created_at DESC,id DESC)
  WHERE scope_type IS NOT NULL;

UPDATE access_roles
SET permissions=ARRAY(SELECT DISTINCT permission FROM unnest(permissions || ARRAY['access.audit.read']) AS expanded(permission) ORDER BY permission)
WHERE id IN ('administrator','platform_admin');
