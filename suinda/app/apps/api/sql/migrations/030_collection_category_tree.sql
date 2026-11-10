ALTER TABLE lists ADD COLUMN IF NOT EXISTS parent_list_id uuid REFERENCES lists(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS lists_parent_position_idx ON lists(board_id,parent_list_id,position);
