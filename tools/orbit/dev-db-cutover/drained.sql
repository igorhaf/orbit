-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Inclusão interna em transação.
DO $$
DECLARE
  db_id oid := (SELECT oid FROM pg_database WHERE datname = current_database());
BEGIN
  IF EXISTS (SELECT FROM pg_stat_activity WHERE datid = db_id
             AND backend_type = 'client backend' AND pid <> pg_backend_pid()) THEN
    RAISE EXCEPTION 'Drain other sessions before preparing the cutover';
  END IF;
END $$;
