-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Executar com psql -X.
-- Only for an isolated restore under the administrative owner, with 212 already restored.
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('orbit_cutover.allow_restore_target', 'yes', true);
\ir context.sql
\ir operator.sql
DO $$ BEGIN
  IF current_setting('orbit_cutover.mode') NOT IN ('DISPOSABLE_RESTORE', 'OPERATOR_APPROVED_RESTORE') THEN
    RAISE EXCEPTION 'Explicit isolated restore approval mode required';
  END IF;
END $$;
SELECT current_database() AS cutover_db \gset
SELECT pg_advisory_xact_lock(72641025);
LOCK TABLE public.schema_migrations, public.plugin_settings, public.plugin_installations,
  public.editorial_authorization_generation IN ACCESS EXCLUSIVE MODE;
\ir drained.sql
\ir protected-acl.sql
\ir r6-runtime-acl.sql
\ir after.sql
\ir r6-after.sql
COMMIT;
