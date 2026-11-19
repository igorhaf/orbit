-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Executar com psql -X.
SET LOCAL ROLE :"owner_role";
REVOKE CREATE ON SCHEMA public FROM PUBLIC, :"app_role", :"writer_role", :"reader_role";
REVOKE CREATE, TEMPORARY ON DATABASE :"cutover_db" FROM PUBLIC, :"app_role", :"writer_role", :"reader_role";
GRANT CONNECT ON DATABASE :"cutover_db" TO :"app_role", :"writer_role", :"reader_role";
GRANT USAGE ON SCHEMA public TO :"app_role", :"writer_role", :"reader_role";

REVOKE ALL ON public.plugin_settings, public.plugin_installations, public.editorial_authorization_generation
  FROM PUBLIC, :"app_role", :"writer_role", :"reader_role";
REVOKE ALL (plugin_id, enabled, updated_at) ON public.plugin_settings
  FROM PUBLIC, :"app_role", :"writer_role", :"reader_role";
REVOKE ALL (plugin_id, installed, updated_at) ON public.plugin_installations
  FROM PUBLIC, :"app_role", :"writer_role", :"reader_role";
REVOKE ALL ON FUNCTION public.orbit_editorial_generation_guard()
  FROM PUBLIC, :"app_role", :"writer_role", :"reader_role";

GRANT SELECT ON public.plugin_settings, public.plugin_installations TO :"app_role", :"reader_role";
GRANT SELECT ON public.editorial_authorization_generation TO :"writer_role", :"reader_role";
GRANT SELECT (plugin_id, enabled), INSERT (plugin_id, enabled), UPDATE (enabled, updated_at)
  ON public.plugin_settings TO :"writer_role";
GRANT UPDATE (revision) ON public.editorial_authorization_generation TO :"writer_role";

-- The writer can verify the exact migration without reading the migration ledger.
CREATE OR REPLACE VIEW public.orbit_plugin_settings_migration_212 WITH (security_barrier = true) AS
  SELECT checksum FROM public.schema_migrations WHERE version = '212_editorial_authorization_generation.sql';
REVOKE ALL ON public.orbit_plugin_settings_migration_212 FROM PUBLIC, :"app_role", :"writer_role", :"reader_role";
GRANT SELECT ON public.orbit_plugin_settings_migration_212 TO :"writer_role";

RESET ROLE;
ALTER ROLE :"app_role" IN DATABASE :"cutover_db" SET search_path = pg_catalog, public;
ALTER ROLE :"writer_role" IN DATABASE :"cutover_db" SET search_path = pg_catalog, public;
ALTER ROLE :"reader_role" IN DATABASE :"cutover_db" SET search_path = pg_catalog, public;
