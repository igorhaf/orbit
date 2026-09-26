ALTER TABLE card_execution_configs ADD COLUMN IF NOT EXISTS overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Existing execution settings were already intentional card-level settings.
UPDATE card_execution_configs
SET overrides=jsonb_strip_nulls(jsonb_build_object(
  'agent',agent,'executor',executor,'action',action,'skills',skills,
  'working_directory',working_directory,'mode',mode,'permissions',permissions,
  'context',context,'integrations',integrations,'automation',automation
))
WHERE overrides='{}'::jsonb;

ALTER TABLE lists ADD COLUMN IF NOT EXISTS is_completion_list boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS lists_one_completion_list_per_board
  ON lists(board_id) WHERE is_completion_list AND archived_at IS NULL;

CREATE OR REPLACE FUNCTION orbit_sync_card_completion() RETURNS trigger AS $$
DECLARE has_completion boolean; destination_is_completion boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM lists l WHERE l.board_id=(SELECT board_id FROM lists WHERE id=NEW.list_id)
                AND l.is_completion_list AND l.archived_at IS NULL),
         COALESCE((SELECT is_completion_list FROM lists WHERE id=NEW.list_id),false)
  INTO has_completion,destination_is_completion;
  IF has_completion THEN NEW.completed=destination_is_completion; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS orbit_sync_card_completion ON cards;
CREATE TRIGGER orbit_sync_card_completion
  BEFORE INSERT OR UPDATE OF list_id,completed ON cards
  FOR EACH ROW EXECUTE FUNCTION orbit_sync_card_completion();
