CREATE TABLE IF NOT EXISTS automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  tags text[] NOT NULL DEFAULT '{}',
  definition jsonb NOT NULL,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automations_board_idx ON automations(board_id);
CREATE TABLE IF NOT EXISTS automation_events (
  id bigserial PRIMARY KEY,
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  card_id uuid REFERENCES cards(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  chain uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS automation_events_pending_idx ON automation_events(id) WHERE processed_at IS NULL;
CREATE TABLE IF NOT EXISTS automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  status text NOT NULL CHECK(status IN ('success','skipped','error')),
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(automation_id,event_key)
);
CREATE TABLE IF NOT EXISTS automation_mail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Capture committed mutations from every API path, including bulk operations.
CREATE OR REPLACE FUNCTION orbit_automation_event() RETURNS trigger AS $$
DECLARE
  cid uuid;
  bid uuid;
  event_type text;
  old_row jsonb := '{}';
  new_row jsonb := '{}';
  trace uuid[];
BEGIN
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  IF TG_OP='UPDATE' AND old_row - 'updated_at' = new_row - 'updated_at' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='cards' THEN
    cid := NEW.id;
    event_type := CASE WHEN TG_OP='INSERT' THEN 'card_created'
      WHEN OLD.list_id IS DISTINCT FROM NEW.list_id THEN 'card_moved'
      WHEN OLD.completed IS DISTINCT FROM NEW.completed THEN 'card_completed'
      WHEN OLD.due_date IS DISTINCT FROM NEW.due_date THEN 'due_changed'
      ELSE 'card_updated' END;
  ELSE
    cid := COALESCE((new_row->>'card_id')::uuid,(old_row->>'card_id')::uuid);
    event_type := CASE TG_TABLE_NAME WHEN 'card_labels' THEN 'label_changed'
      WHEN 'card_assignees' THEN 'member_changed' WHEN 'comments' THEN 'comment_added'
      WHEN 'card_custom_values' THEN 'field_changed' ELSE 'checklist_changed' END;
  END IF;
  SELECT l.board_id INTO bid FROM cards c JOIN lists l ON l.id=c.list_id WHERE c.id=cid;
  IF bid IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
  trace := COALESCE(NULLIF(current_setting('orbit.automation_chain',true),'')::uuid[],'{}'::uuid[]);
  INSERT INTO automation_events(board_id,card_id,kind,payload,chain)
  VALUES(bid,cid,event_type,jsonb_build_object('before',old_row - 'description','after',new_row - 'description'),trace);
  RETURN COALESCE(NEW,OLD);
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS orbit_cards_automation ON cards;
CREATE TRIGGER orbit_cards_automation AFTER INSERT OR UPDATE ON cards FOR EACH ROW EXECUTE FUNCTION orbit_automation_event();
DROP TRIGGER IF EXISTS orbit_labels_automation ON card_labels;
CREATE TRIGGER orbit_labels_automation AFTER INSERT OR DELETE ON card_labels FOR EACH ROW EXECUTE FUNCTION orbit_automation_event();
DROP TRIGGER IF EXISTS orbit_members_automation ON card_assignees;
CREATE TRIGGER orbit_members_automation AFTER INSERT OR DELETE ON card_assignees FOR EACH ROW EXECUTE FUNCTION orbit_automation_event();
DROP TRIGGER IF EXISTS orbit_fields_automation ON card_custom_values;
CREATE TRIGGER orbit_fields_automation AFTER INSERT OR UPDATE OR DELETE ON card_custom_values FOR EACH ROW EXECUTE FUNCTION orbit_automation_event();
DROP TRIGGER IF EXISTS orbit_comments_automation ON comments;
CREATE TRIGGER orbit_comments_automation AFTER INSERT ON comments FOR EACH ROW EXECUTE FUNCTION orbit_automation_event();
DROP TRIGGER IF EXISTS orbit_checklist_automation ON checklist_items;
CREATE TRIGGER orbit_checklist_automation AFTER INSERT OR UPDATE ON checklist_items FOR EACH ROW EXECUTE FUNCTION orbit_automation_event();
