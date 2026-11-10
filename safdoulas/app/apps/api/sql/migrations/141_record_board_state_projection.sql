-- Projection of a formal record state; phase names and scope are supplied by its plugin.
CREATE FUNCTION sync_record_board_phase() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state IS DISTINCT FROM OLD.state THEN
  UPDATE cards c SET list_id=p.list_id
  FROM record_card_links link JOIN record_board_phases p ON p.board_id=link.board_id
  WHERE link.record_id=NEW.id AND p.phase_id=NEW.state AND c.id=link.card_id AND c.list_id<>p.list_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER record_board_phase_changed AFTER UPDATE OF state ON extension_records
 FOR EACH ROW EXECUTE FUNCTION sync_record_board_phase();
