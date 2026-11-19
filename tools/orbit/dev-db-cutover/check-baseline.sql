-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Inclusão interna em transação.
DO $$
DECLARE
  expected_owner regrole := current_setting('orbit_cutover.protected_owner')::regrole;
  owner_id regrole := current_setting('orbit_cutover.ledger_owner')::regrole;
  protected oid[] := ARRAY['public.plugin_settings'::regclass, 'public.plugin_installations'::regclass];
BEGIN
  IF to_regclass('public.editorial_authorization_generation') IS NOT NULL
     OR to_regprocedure('public.orbit_editorial_generation_guard()') IS NOT NULL
     OR NOT EXISTS (SELECT FROM pg_class WHERE oid = to_regclass('public.schema_migrations')
                    AND relkind = 'r' AND relowner = owner_id)
  THEN
    RAISE EXCEPTION 'Unexpected generation objects or migration ledger';
  END IF;
  IF EXISTS (SELECT FROM public.schema_migrations WHERE version LIKE '212\_%' ESCAPE '\')
     OR (SELECT count(*) FROM pg_class WHERE oid = ANY(protected)
         AND relkind = 'r' AND relowner = expected_owner AND NOT relispartition
         AND NOT relrowsecurity AND NOT relhasrules) <> 2
     OR EXISTS (SELECT FROM pg_trigger WHERE tgrelid = ANY(protected) AND NOT tgisinternal)
     OR EXISTS (SELECT FROM pg_constraint WHERE contype = 'f' AND conrelid = ANY(protected))
     OR EXISTS (SELECT FROM pg_inherits WHERE inhrelid = ANY(protected) OR inhparent = ANY(protected))
  THEN
    RAISE EXCEPTION 'Unexpected migration or protected table baseline';
  END IF;
END $$;
