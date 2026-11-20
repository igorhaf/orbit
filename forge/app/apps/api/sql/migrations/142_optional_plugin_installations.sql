CREATE TABLE plugin_installations(
 plugin_id text PRIMARY KEY,
 installed boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO plugin_settings(plugin_id,enabled) VALUES('vault',true) ON CONFLICT(plugin_id) DO NOTHING;
DO $$ DECLARE owner_name text; permission record;
BEGIN
 SELECT tableowner INTO owner_name FROM pg_tables WHERE schemaname=current_schema() AND tablename='plugin_settings';
 EXECUTE format('ALTER TABLE plugin_installations OWNER TO %I',owner_name);
 FOR permission IN SELECT DISTINCT grantee,privilege_type FROM information_schema.role_table_grants WHERE table_schema=current_schema() AND table_name='plugin_settings' AND grantee<>'PUBLIC' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
 LOOP EXECUTE format('GRANT %s ON plugin_installations TO %I',permission.privilege_type,permission.grantee);END LOOP;
END $$;
