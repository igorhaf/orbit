-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Inclusão interna em transação.
\ir identity.sql
DO $$
DECLARE
  owner_name text := current_setting('orbit_cutover.owner');
BEGIN
  IF NOT EXISTS (SELECT FROM pg_database WHERE datname = current_database()
                 AND datdba = owner_name::regrole)
     OR NOT EXISTS (SELECT FROM pg_namespace WHERE nspname = 'public'
                    AND nspowner IN (owner_name::regrole, 'pg_database_owner'::regrole))
  THEN
    RAISE EXCEPTION 'Administrative database and schema ownership must be verified first';
  END IF;
END $$;
