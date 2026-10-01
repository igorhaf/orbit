ALTER TABLE boards ADD COLUMN IF NOT EXISTS is_collection boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS boards_owner_collection_idx ON boards(owner_id) WHERE is_collection;
