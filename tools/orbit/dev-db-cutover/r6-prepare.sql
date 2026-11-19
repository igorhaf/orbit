-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Executar com psql -X.
\set ON_ERROR_STOP on
BEGIN;
\ir identity.sql
\ir operator.sql
SELECT current_database() AS cutover_db \gset
SELECT pg_advisory_xact_lock(72641025);
LOCK TABLE public.schema_migrations, public.plugin_settings, public.plugin_installations IN ACCESS EXCLUSIVE MODE;
\ir r6-before.sql
SELECT oid::text AS old_pgcrypto_oid, extversion AS old_pgcrypto_version
FROM pg_extension WHERE extname = 'pgcrypto'
\gset
-- The reviewed ownership manifest and shared-object guard above bound this transfer.
REASSIGN OWNED BY :"app_role" TO :"owner_role";
SELECT set_config('orbit_cutover.pgcrypto_oid', :'old_pgcrypto_oid', true),
       set_config('orbit_cutover.pgcrypto_version', :'old_pgcrypto_version', true);
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_extension
       WHERE extname = 'pgcrypto'
         AND extowner = current_setting('orbit_cutover.owner')::regrole
         AND oid = current_setting('orbit_cutover.pgcrypto_oid')::oid
         AND extversion = current_setting('orbit_cutover.pgcrypto_version'))
  THEN
    RAISE EXCEPTION 'pgcrypto must transfer in place with identity and version preserved';
  END IF;
END $$;
\ir prepare-protected.sql
\ir r6-runtime-acl.sql
\ir after.sql
\ir r6-after.sql
COMMIT;
