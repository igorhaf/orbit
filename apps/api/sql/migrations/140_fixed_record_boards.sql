CREATE TABLE record_board_phases(
 board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
 phase_id text NOT NULL,
 list_id uuid NOT NULL UNIQUE REFERENCES lists(id) ON DELETE CASCADE,
 PRIMARY KEY(board_id,phase_id)
);
CREATE TABLE record_board_template_uses(
 board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
 operation_key uuid NOT NULL,
 template_id text NOT NULL,
 card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(board_id,operation_key)
);
DO $$ DECLARE owner_name text; permission record; tab text;
BEGIN
 SELECT tableowner INTO owner_name FROM pg_tables WHERE schemaname=current_schema() AND tablename='extension_records';
 FOREACH tab IN ARRAY ARRAY['record_board_phases','record_board_template_uses'] LOOP
  EXECUTE format('ALTER TABLE %I OWNER TO %I',tab,owner_name);
  FOR permission IN SELECT DISTINCT grantee,privilege_type FROM information_schema.role_table_grants
   WHERE table_schema=current_schema() AND table_name='extension_records' AND grantee<>'PUBLIC' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
  LOOP EXECUTE format('GRANT %s ON %I TO %I',permission.privilege_type,tab,permission.grantee);END LOOP;
 END LOOP;
END $$;
