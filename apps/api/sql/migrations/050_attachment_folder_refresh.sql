CREATE OR REPLACE FUNCTION mark_card_attachment_folders_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE attachment_backup_cloud_copies SET organized_at=NULL WHERE card_id=NEW.id AND status='success';
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS card_attachment_folders_stale ON cards;
CREATE TRIGGER card_attachment_folders_stale AFTER UPDATE OF title,list_id ON cards
FOR EACH ROW WHEN (OLD.title IS DISTINCT FROM NEW.title OR OLD.list_id IS DISTINCT FROM NEW.list_id)
EXECUTE FUNCTION mark_card_attachment_folders_stale();

CREATE OR REPLACE FUNCTION mark_board_attachment_folders_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE attachment_backup_cloud_copies copy SET organized_at=NULL
  FROM cards card JOIN lists ls ON ls.id=card.list_id
  WHERE copy.card_id=card.id AND ls.board_id=NEW.id AND copy.status='success';
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS board_attachment_folders_stale ON boards;
CREATE TRIGGER board_attachment_folders_stale AFTER UPDATE OF title ON boards
FOR EACH ROW WHEN (OLD.title IS DISTINCT FROM NEW.title)
EXECUTE FUNCTION mark_board_attachment_folders_stale();

CREATE OR REPLACE FUNCTION mark_deleted_card_attachment_folders_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE attachment_backup_cloud_copies SET organized_at=NULL WHERE card_id=OLD.id AND status='success';
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS deleted_card_attachment_folders_stale ON cards;
CREATE TRIGGER deleted_card_attachment_folders_stale AFTER DELETE ON cards
FOR EACH ROW EXECUTE FUNCTION mark_deleted_card_attachment_folders_stale();
