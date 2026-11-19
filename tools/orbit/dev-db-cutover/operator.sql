-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Executar com psql -X.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = session_user AND rolsuper)
     OR session_user <> current_user THEN
    RAISE EXCEPTION 'Preparation requires a direct administrative operator login';
  END IF;
END $$;
