-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Inclusão interna em transação.
SELECT set_config('orbit_cutover.expected_ownership', :'ownership_sha256', true);
DO $$
DECLARE
  app_id oid := current_setting('orbit_cutover.app')::regrole;
  db_id oid := (SELECT oid FROM pg_database WHERE datname = current_database());
BEGIN
  IF NOT EXISTS (SELECT FROM pg_database WHERE oid = db_id AND datdba = app_id)
     OR NOT EXISTS (SELECT FROM pg_namespace WHERE nspname = 'public'
                    AND nspowner = 'pg_database_owner'::regrole)
     OR EXISTS (SELECT FROM pg_shdepend
        WHERE refclassid = 'pg_authid'::regclass AND refobjid = app_id AND deptype = 'o'
          AND dbid = 0 AND NOT (classid = 'pg_database'::regclass AND objid = db_id))
  THEN
    RAISE EXCEPTION 'R6 expects legacy ownership of this database only among shared objects';
  END IF;
  IF to_regclass('public.card_revisions') IS NULL
    OR NOT EXISTS (SELECT FROM pg_attribute WHERE attrelid='public.cards'::regclass
      AND attname='card_revision' AND NOT attisdropped)
    OR NOT EXISTS (SELECT FROM pg_attribute WHERE attrelid='public.card_runs'::regclass
      AND attname='worker_id' AND NOT attisdropped)
  THEN
    RAISE EXCEPTION 'Review prerequisite DEV runtime migrations 157_card_revisions and 158_workspace_coordination before cutover';
  END IF;
  -- The observed DEV baseline uses owner-derived privileges for ordinary relations.
  IF EXISTS (SELECT FROM pg_class WHERE relnamespace = 'public'::regnamespace
      AND relkind IN ('r','p','v','m','S','f') AND (relowner <> app_id OR relacl IS NOT NULL))
     OR EXISTS (SELECT FROM pg_attribute a JOIN pg_class c ON a.attrelid = c.oid
      WHERE c.relnamespace = 'public'::regnamespace AND a.attacl IS NOT NULL)
  THEN
    RAISE EXCEPTION 'R6 expects owner-derived relation privileges; review changed grants first';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
       WHERE e.extname = 'pgcrypto' AND e.extowner = app_id AND n.nspname = 'public')
     OR EXISTS (SELECT FROM pg_extension WHERE extowner = app_id AND extname <> 'pgcrypto')
  THEN
    RAISE EXCEPTION 'Unexpected legacy extension ownership';
  END IF;
END $$;
\ir r6-ownership-fingerprint.sql
SELECT set_config('orbit_cutover.observed_ownership', :'observed_ownership_sha256', true);
DO $$ BEGIN
  IF current_setting('orbit_cutover.expected_ownership') !~ '^[0-9a-f]{64}$'
     OR current_setting('orbit_cutover.expected_ownership') <> current_setting('orbit_cutover.observed_ownership')
  THEN
    RAISE EXCEPTION 'R6 ownership inventory differs from the approved review';
  END IF;
END $$;
SELECT set_config('orbit_cutover.protected_owner', :'app_role', true);
-- At this stage the ledger is still owned by the legacy login.
SELECT set_config('orbit_cutover.ledger_owner', :'app_role', true);
\ir check-baseline.sql
\ir drained.sql
