-- Read-only diagnostics. Run separately while connected as each candidate role.
-- Never paste connection strings or secrets into this file or its output.
SELECT current_database() AS database_name,
       session_user AS login_role,
       current_user AS effective_role,
       current_setting('server_version') AS server_version;

SELECT r.rolname, r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb,
       r.rolreplication, r.rolbypassrls
FROM pg_roles r
WHERE r.rolname IN (session_user, current_user)
ORDER BY r.rolname;

SELECT member.rolname AS member_role, granted.rolname AS granted_role,
       m.admin_option, m.inherit_option, m.set_option
FROM pg_auth_members m
JOIN pg_roles member ON member.oid=m.member
JOIN pg_roles granted ON granted.oid=m.roleid
WHERE member.rolname IN (session_user, current_user)
ORDER BY member_role, granted_role;

WITH expected(name) AS (VALUES
 ('plugin_settings'), ('plugin_installations'),
 ('editorial_authorization_generation')
)
SELECT e.name, c.oid IS NOT NULL AS exists,
       pg_get_userbyid(c.relowner) AS owner,
       has_table_privilege(current_user, c.oid, 'SELECT') AS can_select,
       has_table_privilege(current_user, c.oid, 'INSERT') AS can_insert,
       has_table_privilege(current_user, c.oid, 'UPDATE') AS can_update,
       has_table_privilege(current_user, c.oid, 'DELETE') AS can_delete,
       has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate
FROM expected e LEFT JOIN pg_class c
 ON c.oid=to_regclass(format('%I.%I',current_schema(),e.name))
ORDER BY e.name;

SELECT table_name, column_name,
       has_column_privilege(current_user,
         format('%I.%I',current_schema(),table_name), column_name, 'SELECT') AS can_select,
       has_column_privilege(current_user,
         format('%I.%I',current_schema(),table_name), column_name, 'INSERT') AS can_insert,
       has_column_privilege(current_user,
         format('%I.%I',current_schema(),table_name), column_name, 'UPDATE') AS can_update
FROM information_schema.columns
WHERE table_schema=current_schema()
 AND table_name IN ('plugin_settings','plugin_installations','editorial_authorization_generation')
ORDER BY table_name, ordinal_position;

SELECT n.nspname AS schema_name,
       has_schema_privilege(current_user,n.oid,'USAGE') AS can_use,
       has_schema_privilege(current_user,n.oid,'CREATE') AS can_create
FROM pg_namespace n WHERE n.nspname=current_schema();

SELECT p.oid::regprocedure AS function_name,
       pg_get_userbyid(p.proowner) AS owner,
       has_function_privilege(current_user,p.oid,'EXECUTE') AS can_execute,
       EXISTS (
         SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
         WHERE a.grantee=0
       ) AS public_execute
FROM pg_proc p
WHERE p.proname IN ('orbit_editorial_generation_guard',
                    'orbit_editorial_policy_version_guard',
                    'orbit_discovery_canonical')
ORDER BY p.proname;

SELECT t.tgname, t.tgenabled, c.relname AS table_name
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
WHERE NOT t.tgisinternal
 AND c.relname IN ('editorial_authorization_generation',
                   'plugin_settings','plugin_installations')
ORDER BY c.relname,t.tgname;

SELECT version, checksum, applied_at
FROM schema_migrations
WHERE version IN ('210_discovery_review.sql',
                  '211_discovery_editorial_policies.sql',
                  '212_editorial_authorization_generation.sql')
ORDER BY version;
