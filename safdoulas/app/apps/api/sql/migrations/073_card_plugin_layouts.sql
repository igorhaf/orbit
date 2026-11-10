CREATE TABLE card_plugin_layouts (
 card_id uuid PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
 plugin_ids text[] NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
-- Preserve existing card features; new cards start with the basic layout.
INSERT INTO card_plugin_layouts(card_id,plugin_ids)
 SELECT c.id,CASE WHEN COALESCE(c.ai_project_id,b.ai_default_project_id) IS NOT NULL
 THEN ARRAY['ai','software-development'] ELSE ARRAY['ai'] END
 FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id;
