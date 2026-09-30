ALTER TABLE cards ADD COLUMN IF NOT EXISTS card_role varchar(16) NOT NULL DEFAULT 'task';
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_card_role_check;
ALTER TABLE cards ADD CONSTRAINT cards_card_role_check CHECK (card_role IN ('task','calendar','planner','vault'));

ALTER TABLE vault_items ADD COLUMN IF NOT EXISTS card_id uuid UNIQUE REFERENCES cards(id) ON DELETE CASCADE;

DO $$
DECLARE
  item RECORD;
  target_list uuid;
  new_card uuid;
BEGIN
  FOR item IN SELECT id,owner_id,title,notes FROM vault_items WHERE card_id IS NULL LOOP
    SELECT l.id INTO target_list
      FROM lists l JOIN boards b ON b.id=l.board_id
      WHERE b.owner_id=item.owner_id AND b.is_inbox AND l.archived_at IS NULL
      ORDER BY l.position LIMIT 1;
    IF target_list IS NOT NULL THEN
      INSERT INTO cards(list_id,title,description,position,card_role)
      VALUES(target_list,item.title,item.notes,
        COALESCE((SELECT max(position)+1 FROM cards WHERE list_id=target_list AND archived_at IS NULL),0),
        'vault') RETURNING id INTO new_card;
      UPDATE vault_items SET card_id=new_card WHERE id=item.id;
    END IF;
    target_list := NULL;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS cards_role_schedule_idx ON cards(card_role,schedule_start_at) WHERE archived_at IS NULL;
