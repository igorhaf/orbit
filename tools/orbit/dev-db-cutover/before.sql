-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Inclusão interna em transação.
SELECT set_config('orbit_cutover.protected_owner', :'app_role', true);
SELECT set_config('orbit_cutover.ledger_owner', :'owner_role', true);
\ir check-baseline.sql
\ir drained.sql
DO $$
DECLARE
  legacy regrole := current_setting('orbit_cutover.app')::regrole;
  db_id oid := (SELECT oid FROM pg_database WHERE datname = current_database());
  protected oid[] := ARRAY['public.plugin_settings'::regclass, 'public.plugin_installations'::regclass];
BEGIN
  IF EXISTS (
    SELECT FROM pg_shdepend
    WHERE dbid IN (0, db_id) AND refclassid = 'pg_authid'::regclass
      AND refobjid = legacy AND deptype = 'o'
      AND NOT (dbid = db_id AND classid = 'pg_class'::regclass AND objid = ANY(protected))
  ) THEN
    RAISE EXCEPTION 'Legacy role owns additional objects. Review ownership and ordinary access first';
  END IF;
END $$;
