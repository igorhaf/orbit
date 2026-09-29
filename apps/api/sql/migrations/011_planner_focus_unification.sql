-- Keep the existing identifiers while moving legacy AI focus blocks into the
-- same local mirror used by the Planner workspace.
INSERT INTO focus_events(id,user_id,title,starts_at,ends_at,created_at)
SELECT id,user_id,left(title,160),starts_at,ends_at,created_at
FROM focus_blocks
ON CONFLICT (id) DO NOTHING;

INSERT INTO focus_event_cards(event_id,card_id)
SELECT fbc.focus_block_id,fbc.card_id
FROM focus_block_cards fbc
JOIN focus_blocks fb ON fb.id=fbc.focus_block_id
JOIN focus_events fe ON fe.id=fb.id AND fe.user_id=fb.user_id
ON CONFLICT DO NOTHING;
