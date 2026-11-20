-- Match the existing record storage privileges for installations with a separate runtime role.
DO $$
DECLARE owner_name text; permission record;
BEGIN
 SELECT tableowner INTO owner_name FROM pg_tables WHERE schemaname=current_schema() AND tablename='extension_records';
 EXECUTE format('ALTER TABLE record_card_links OWNER TO %I',owner_name);
 FOR permission IN SELECT DISTINCT grantee,privilege_type FROM information_schema.role_table_grants
  WHERE table_schema=current_schema() AND table_name='extension_records' AND grantee<>'PUBLIC'
   AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
 LOOP EXECUTE format('GRANT %s ON record_card_links TO %I',permission.privilege_type,permission.grantee);END LOOP;
END $$;
