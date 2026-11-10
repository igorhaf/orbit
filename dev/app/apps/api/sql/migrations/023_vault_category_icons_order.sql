ALTER TABLE vault_categories
  ADD COLUMN IF NOT EXISTS icon varchar(32) NOT NULL DEFAULT 'LockKeyhole',
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;

WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY owner_id ORDER BY lower(name), id) - 1 AS position
  FROM vault_categories
)
UPDATE vault_categories category
SET position = ordered.position
FROM ordered
WHERE category.id = ordered.id;

CREATE INDEX IF NOT EXISTS vault_categories_owner_position_idx
  ON vault_categories(owner_id, position, id);
