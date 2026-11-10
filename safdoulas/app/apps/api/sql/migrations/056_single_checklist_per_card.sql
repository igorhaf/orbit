WITH ranked AS (
  SELECT id, card_id, row_number() OVER (PARTITION BY card_id ORDER BY position, id) AS rank
  FROM checklists
), keeper AS (
  SELECT card_id, id FROM ranked WHERE rank = 1
), moved AS (
  SELECT ci.id, k.id AS checklist_id,
    row_number() OVER (PARTITION BY ci.card_id ORDER BY cl.position, ci.position, ci.id) - 1 AS position
  FROM checklist_items ci
  JOIN checklists cl ON cl.id = ci.checklist_id
  JOIN keeper k ON k.card_id = ci.card_id
)
UPDATE checklist_items ci
SET checklist_id = moved.checklist_id, position = moved.position
FROM moved WHERE ci.id = moved.id;
DELETE FROM checklists cl
WHERE EXISTS (SELECT 1 FROM checklists kept WHERE kept.card_id = cl.card_id AND kept.id <> cl.id);
UPDATE checklists SET title = 'Checklist', position = 0;
CREATE UNIQUE INDEX IF NOT EXISTS checklists_one_per_card_idx ON checklists(card_id);
