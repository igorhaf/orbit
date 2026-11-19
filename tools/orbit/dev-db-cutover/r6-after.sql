-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Inclusão interna em transação.
DO $$
DECLARE
  owner_id oid := current_setting('orbit_cutover.owner')::regrole;
  app_id oid := current_setting('orbit_cutover.app')::regrole;
  writer_id oid := current_setting('orbit_cutover.writer')::regrole;
  reader_id oid := current_setting('orbit_cutover.reader')::regrole;
  object_id regclass;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_extension WHERE extname = 'pgcrypto' AND extowner = owner_id)
     OR EXISTS (
       SELECT FROM pg_database d, LATERAL aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
       WHERE d.datname = current_database() AND a.grantee = 0
     )
     OR EXISTS (
       SELECT FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a
       WHERE n.nspname = 'public' AND a.grantee = 0
     )
  THEN
    RAISE EXCEPTION 'Unexpected pgcrypto ownership or PUBLIC database/schema ACL';
  END IF;

  FOREACH object_id IN ARRAY ARRAY['public.users'::regclass, 'public.access_roles'::regclass,
    'public.access_grants'::regclass, 'public.access_groups'::regclass,
    'public.access_group_members'::regclass, 'public.access_user_exceptions'::regclass,
    'public.access_permission_settings'::regclass, 'public.workspaces'::regclass,
    'public.boards'::regclass, 'public.lists'::regclass, 'public.cards'::regclass] LOOP
    IF NOT has_table_privilege(app_id, object_id, 'SELECT')
       OR has_table_privilege(app_id, object_id, 'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE,TRIGGER')
    THEN
      RAISE EXCEPTION 'Unexpected general runtime privileges on %', object_id;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
      AND c.oid NOT IN ('public.plugin_settings'::regclass, 'public.plugin_installations'::regclass,
        'public.editorial_authorization_generation'::regclass, 'public.orbit_plugin_settings_migration_212'::regclass)
      AND (has_any_column_privilege(writer_id, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
           OR has_table_privilege(writer_id, c.oid, 'DELETE,TRUNCATE,TRIGGER')
           OR has_any_column_privilege(reader_id, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
           OR has_table_privilege(reader_id, c.oid, 'DELETE,TRUNCATE,TRIGGER'))
  ) OR EXISTS (
    SELECT FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
      AND (has_sequence_privilege(writer_id, c.oid, 'USAGE,SELECT,UPDATE')
        OR has_sequence_privilege(reader_id, c.oid, 'USAGE,SELECT,UPDATE'))
  ) THEN
    RAISE EXCEPTION 'Private writer or observer has ordinary data privileges';
  END IF;
END $$;
