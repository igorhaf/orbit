-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Inclusão interna em transação.
DO $$
DECLARE
  owner_id oid := current_setting('orbit_cutover.owner')::regrole;
  app_id oid := current_setting('orbit_cutover.app')::regrole;
  writer_id oid := current_setting('orbit_cutover.writer')::regrole;
  reader_id oid := current_setting('orbit_cutover.reader')::regrole;
  role_id oid;
  settings_id oid := 'public.plugin_settings'::regclass;
  installs_id oid := 'public.plugin_installations'::regclass;
  generation_id oid := 'public.editorial_authorization_generation'::regclass;
  guard_id oid := 'public.orbit_editorial_generation_guard()'::regprocedure;
  ledger_id oid := 'public.schema_migrations'::regclass;
  evidence_id oid := 'public.orbit_plugin_settings_migration_212'::regclass;
  protected oid[] := ARRAY[settings_id, installs_id, generation_id];
BEGIN
  IF (SELECT count(*) FROM pg_class WHERE oid = ANY(protected) AND relowner = owner_id) <> 3
     OR NOT EXISTS (SELECT FROM pg_class WHERE oid = ledger_id AND relowner = owner_id)
     OR NOT EXISTS (SELECT FROM pg_class WHERE oid = evidence_id AND relowner = owner_id AND relkind = 'v')
     OR NOT has_table_privilege(writer_id, evidence_id, 'SELECT')
     OR EXISTS (SELECT FROM pg_class c, LATERAL aclexplode(c.relacl) acl
       WHERE c.oid = evidence_id AND acl.grantee <> owner_id
         AND NOT (acl.grantee = writer_id AND acl.privilege_type = 'SELECT' AND NOT acl.is_grantable))
     OR EXISTS (SELECT FROM pg_attribute a WHERE a.attrelid = evidence_id AND a.attacl IS NOT NULL)
     OR EXISTS (SELECT FROM pg_trigger WHERE tgrelid IN (settings_id, installs_id) AND NOT tgisinternal)
     OR EXISTS (SELECT FROM pg_constraint WHERE contype = 'f' AND conrelid = ANY(protected))
     OR NOT EXISTS (SELECT FROM pg_proc WHERE oid = guard_id AND proowner = owner_id AND NOT prosecdef)
     OR NOT EXISTS (SELECT FROM public.schema_migrations
        WHERE version = '212_editorial_authorization_generation.sql'
          AND checksum = '2619740b0897181d8503f398bc37a16d054b581c83843c9ae4df2bc8dab9d8e9')
     OR (SELECT count(*) FROM public.editorial_authorization_generation
         WHERE singleton AND authorization_state = 'unavailable') <> 1
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = generation_id AND tgfoid = guard_id
         AND tgenabled = 'O' AND tgname IN ('editorial_generation_update_guard',
                                           'editorial_generation_no_truncate')) <> 2
  THEN
    RAISE EXCEPTION 'Ownership, migration ledger or generation guard differs from expected';
  END IF;

  IF EXISTS (
    SELECT FROM pg_class c, LATERAL aclexplode(c.relacl) acl
    WHERE c.oid = ANY(protected) AND acl.grantee <> owner_id
      AND NOT (acl.privilege_type = 'SELECT' AND NOT acl.is_grantable AND
           ((c.oid IN (settings_id, installs_id) AND acl.grantee IN (app_id, reader_id))
             OR (c.oid = generation_id AND acl.grantee IN (writer_id, reader_id))))
  ) OR EXISTS (
    SELECT FROM pg_attribute a, LATERAL aclexplode(a.attacl) acl
    WHERE a.attrelid = ANY(protected) AND acl.grantee <> owner_id
      AND NOT (acl.grantee = writer_id AND NOT acl.is_grantable AND (
        (a.attrelid = settings_id AND (
          (a.attname IN ('plugin_id','enabled') AND acl.privilege_type IN ('SELECT','INSERT'))
          OR (a.attname IN ('enabled','updated_at') AND acl.privilege_type = 'UPDATE')))
        OR (a.attrelid = generation_id AND a.attname = 'revision' AND acl.privilege_type = 'UPDATE')))
  ) OR EXISTS (
    SELECT FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    WHERE p.oid = guard_id AND acl.grantee <> owner_id
  ) OR EXISTS (
    SELECT FROM pg_namespace n, LATERAL aclexplode(n.nspacl) acl
    WHERE n.nspname = 'public' AND acl.privilege_type = 'CREATE'
      AND acl.grantee NOT IN (owner_id, 'pg_database_owner'::regrole)
  ) THEN
    RAISE EXCEPTION 'Unexpected or delegable ACL on a protected object';
  END IF;

  FOREACH role_id IN ARRAY ARRAY[app_id, writer_id, reader_id] LOOP
    IF NOT has_database_privilege(role_id, current_database(), 'CONNECT')
       OR has_database_privilege(role_id, current_database(), 'CREATE,TEMP')
       OR NOT has_schema_privilege(role_id, 'public', 'USAGE')
       OR has_table_privilege(role_id, ledger_id, 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
       OR has_any_column_privilege(role_id, ledger_id, 'INSERT,UPDATE')
       OR NOT EXISTS (SELECT FROM pg_db_role_setting
          WHERE setrole = role_id AND setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND 'search_path=pg_catalog, public' = ANY(setconfig))
       OR EXISTS (SELECT FROM pg_namespace n WHERE has_schema_privilege(role_id, n.oid, 'CREATE')
                  OR (n.nspname NOT IN ('public','pg_catalog','information_schema')
                    AND n.nspname !~ '^pg_' AND has_schema_privilege(role_id,n.oid,'USAGE')))
       OR EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.prosecdef AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
            AND has_schema_privilege(role_id,n.oid,'USAGE')
            AND has_function_privilege(role_id,p.oid,'EXECUTE'))
       OR EXISTS (SELECT FROM pg_shdepend
          WHERE dbid IN (0,(SELECT oid FROM pg_database WHERE datname = current_database()))
            AND refclassid = 'pg_authid'::regclass AND refobjid = role_id AND deptype = 'o')
    THEN
      RAISE EXCEPTION 'Restricted role has unexpected ownership or schema/database access: %', role_id::regrole;
    END IF;
    IF role_id IN (app_id, reader_id) AND (
      NOT has_table_privilege(role_id, settings_id, 'SELECT')
      OR NOT has_table_privilege(role_id, installs_id, 'SELECT')
    ) THEN
      RAISE EXCEPTION 'Required configuration reads missing';
    END IF;
  END LOOP;

  IF NOT has_column_privilege(writer_id, settings_id, 'plugin_id', 'SELECT')
     OR NOT has_column_privilege(writer_id, settings_id, 'enabled', 'SELECT')
     OR NOT has_column_privilege(writer_id, settings_id, 'plugin_id', 'INSERT')
     OR NOT has_column_privilege(writer_id, settings_id, 'enabled', 'INSERT')
     OR NOT has_column_privilege(writer_id, settings_id, 'enabled', 'UPDATE')
     OR NOT has_column_privilege(writer_id, settings_id, 'updated_at', 'UPDATE')
     OR NOT has_column_privilege(writer_id, generation_id, 'revision', 'UPDATE')
     OR NOT has_table_privilege(writer_id, generation_id, 'SELECT')
     OR NOT has_table_privilege(reader_id, generation_id, 'SELECT')
  THEN
    RAISE EXCEPTION 'Required participant or reader grants missing';
  END IF;
END $$;
