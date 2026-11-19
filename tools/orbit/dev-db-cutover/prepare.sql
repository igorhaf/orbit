-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Executar com psql -X.
\set ON_ERROR_STOP on
BEGIN;
\ir context.sql
SELECT current_database() AS cutover_db \gset
\ir operator.sql
SELECT pg_advisory_xact_lock(72641025);
LOCK TABLE public.schema_migrations, public.plugin_settings, public.plugin_installations IN ACCESS EXCLUSIVE MODE;
\ir before.sql

ALTER TABLE public.plugin_settings OWNER TO :"owner_role";
ALTER TABLE public.plugin_installations OWNER TO :"owner_role";

\ir prepare-protected.sql
\ir after.sql
COMMIT;
