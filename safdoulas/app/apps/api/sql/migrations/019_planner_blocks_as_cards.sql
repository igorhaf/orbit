DO $$
DECLARE
  focus RECORD;
  target_list uuid;
  context_text text;
BEGIN
  FOR focus IN SELECT e.id,e.user_id,e.title,e.starts_at,e.ends_at FROM focus_events e LOOP
    SELECT l.id INTO target_list
      FROM lists l JOIN boards b ON b.id=l.board_id
      WHERE b.owner_id=focus.user_id AND b.is_inbox AND l.archived_at IS NULL
      ORDER BY l.position LIMIT 1;
    IF target_list IS NULL THEN
      CONTINUE;
    END IF;
    SELECT 'Bloco de foco migrado. Cartões relacionados: ' || COALESCE(string_agg(c.title, ', '), '(nenhum)')
      INTO context_text
      FROM focus_event_cards fec JOIN cards c ON c.id=fec.card_id WHERE fec.event_id=focus.id;
    INSERT INTO cards(list_id,title,description,position,card_role,schedule_start_at,schedule_end_at,schedule_all_day)
      VALUES(target_list,focus.title,context_text,
        COALESCE((SELECT max(position)+1 FROM cards WHERE list_id=target_list AND archived_at IS NULL),0),
        'planner',focus.starts_at,focus.ends_at,false);
    target_list := NULL;
  END LOOP;
END $$;
