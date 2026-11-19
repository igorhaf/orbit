-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Inclusão interna em transação.
SET LOCAL search_path = pg_catalog, public;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
SELECT set_config('orbit_cutover.mode', :'approval', true),
       set_config('orbit_cutover.owner', :'owner_role', true),
       set_config('orbit_cutover.app', :'app_role', true),
       set_config('orbit_cutover.writer', :'writer_role', true),
       set_config('orbit_cutover.reader', :'reader_role', true);
DO $$
DECLARE
  mode text := current_setting('orbit_cutover.mode');
  owner_name text := current_setting('orbit_cutover.owner');
  app_name text := current_setting('orbit_cutover.app');
  roles text[] := ARRAY[owner_name, app_name, current_setting('orbit_cutover.writer'),
                        current_setting('orbit_cutover.reader')];
BEGIN
  IF current_setting('server_version_num')::int / 10000 <> 16 OR NOT (
    (mode = 'DISPOSABLE' AND current_database() = 'orbit_r5ca_fixture'
      AND inet_server_addr() IS NULL)
    OR (mode = 'OPERATOR_APPROVED' AND current_database() = 'orbit_native_dev'
      AND app_name = 'orbit_dev_app')
    OR (current_setting('orbit_cutover.allow_restore_target', true) = 'yes'
      AND ((mode = 'DISPOSABLE_RESTORE' AND current_database() = 'orbit_restore_r6_fixture'
              AND inet_server_addr() IS NULL)
        OR (mode = 'OPERATOR_APPROVED_RESTORE' AND current_database() ~ '^orbit_restore_[a-z0-9_]+$'
              AND app_name = 'orbit_dev_app')))
  ) THEN
    RAISE EXCEPTION 'Unexpected target or approval mode';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname = ANY(roles) AND rolcanlogin
      AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) <> 4
     OR EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r
                ON r.oid IN (m.member,m.roleid) WHERE r.rolname = ANY(roles))
  THEN
    RAISE EXCEPTION 'Expected four distinct restricted logins without memberships';
  END IF;
END $$;
