CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL,
  email varchar(255) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{"theme":"light","notifications":true,"browserNotifications":false,"shortcuts":true,"compactCards":false}'::jsonb;
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(160) NOT NULL,
  background varchar(32) NOT NULL DEFAULT 'blue',
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starred boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE boards ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS favorite_position double precision;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE boards ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS is_inbox boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS boards_owner_inbox_idx ON boards(owner_id) WHERE is_inbox;
CREATE TABLE IF NOT EXISTS board_media (
  board_id uuid PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  mime_type varchar(32) NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS board_members (
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(16) NOT NULL DEFAULT 'member',
  PRIMARY KEY (board_id, user_id)
);
CREATE TABLE IF NOT EXISTS lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  title varchar(160) NOT NULL,
  position double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE lists ADD COLUMN IF NOT EXISTS color varchar(32);
ALTER TABLE lists ADD COLUMN IF NOT EXISTS collapsed boolean NOT NULL DEFAULT false;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS lists_board_position_idx ON lists(board_id, position);
CREATE TABLE IF NOT EXISTS cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  title varchar(300) NOT NULL,
  description text NOT NULL DEFAULT '',
  position double precision NOT NULL DEFAULT 0,
  due_date timestamptz,
  cover_color varchar(32),
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS start_date timestamptz;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS reminder_minutes integer;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS recurrence varchar(16);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS cover_attachment_id uuid;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS cover_size varchar(8) NOT NULL DEFAULT 'normal';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS kind varchar(16) NOT NULL DEFAULT 'normal';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS target_board_id uuid REFERENCES boards(id) ON DELETE SET NULL;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS link_url text;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS mirror_source_id uuid REFERENCES cards(id) ON DELETE CASCADE;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS mirror_expanded boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS cards_mirror_source_idx ON cards(mirror_source_id) WHERE mirror_source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cards_list_position_idx ON cards(list_id, position);
CREATE TABLE IF NOT EXISTS labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL DEFAULT '',
  color varchar(32) NOT NULL DEFAULT 'green'
);
CREATE TABLE IF NOT EXISTS card_labels (
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, label_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at timestamptz;
CREATE TABLE IF NOT EXISTS comment_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  kind varchar(8) NOT NULL CHECK (kind IN ('file','card','board')),
  name varchar(255) NOT NULL,
  url text,
  target_id uuid,
  mime_type varchar(120),
  size_bytes integer,
  data bytea,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comment_attachments_comment_idx ON comment_attachments(comment_id,created_at);
CREATE TABLE IF NOT EXISTS card_watchers (
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(card_id,user_id)
);
CREATE TABLE IF NOT EXISTS list_watchers (
  list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(list_id,user_id)
);
CREATE TABLE IF NOT EXISTS board_watchers (
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(board_id,user_id)
);
CREATE TABLE IF NOT EXISTS checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  text varchar(300) NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  position double precision NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  title varchar(160) NOT NULL DEFAULT 'Checklist',
  position integer NOT NULL DEFAULT 0
);
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS checklist_id uuid REFERENCES checklists(id) ON DELETE CASCADE;
INSERT INTO checklists(card_id,title,position)
SELECT DISTINCT ci.card_id,'Checklist',0 FROM checklist_items ci
WHERE ci.checklist_id IS NULL AND NOT EXISTS (SELECT 1 FROM checklists cl WHERE cl.card_id=ci.card_id);
UPDATE checklist_items ci SET checklist_id=(SELECT cl.id FROM checklists cl WHERE cl.card_id=ci.card_id ORDER BY cl.position,cl.id LIMIT 1)
WHERE ci.checklist_id IS NULL;
ALTER TABLE checklist_items ALTER COLUMN checklist_id SET NOT NULL;
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS assignee_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS due_date timestamptz;
CREATE INDEX IF NOT EXISTS checklist_items_checklist_position_idx ON checklist_items(checklist_id,position);
CREATE TABLE IF NOT EXISTS custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  type varchar(16) NOT NULL CHECK (type IN ('text','number','date','dropdown','checkbox')),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  position integer NOT NULL DEFAULT 0,
  show_on_card boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS card_custom_values (
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value jsonb NOT NULL,
  PRIMARY KEY(card_id,field_id)
);
CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  kind varchar(8) NOT NULL CHECK (kind IN ('file','url','card','board')),
  name varchar(255) NOT NULL,
  url text,
  target_id uuid,
  mime_type varchar(120),
  size_bytes integer,
  data bytea,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_card_position_idx ON attachments(card_id,position);
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_cover_attachment_id_fkey;
ALTER TABLE cards ADD CONSTRAINT cards_cover_attachment_id_fkey FOREIGN KEY (cover_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS card_assignees (
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, user_id)
);
CREATE TABLE IF NOT EXISTS board_visits (
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visited_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX IF NOT EXISTS board_visits_user_idx ON board_visits(user_id, visited_at DESC);
CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id uuid REFERENCES boards(id) ON DELETE CASCADE,
  card_id uuid REFERENCES cards(id) ON DELETE SET NULL,
  kind varchar(32) NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activities_board_created_idx ON activities(board_id, created_at DESC);
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id uuid REFERENCES boards(id) ON DELETE CASCADE,
  card_id uuid REFERENCES cards(id) ON DELETE CASCADE,
  kind varchar(32) NOT NULL,
  title varchar(300) NOT NULL,
  body text NOT NULL DEFAULT '',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS due_at timestamptz;
DELETE FROM notifications WHERE kind='due' AND due_at IS NULL;
DROP INDEX IF EXISTS notifications_due_once_idx;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_due_occurrence_idx ON notifications(user_id, card_id, kind, due_at) WHERE kind = 'due';
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS focus_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(160) NOT NULL DEFAULT 'Focus time', starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS focus_event_cards (
  event_id uuid NOT NULL REFERENCES focus_events(id) ON DELETE CASCADE, card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  PRIMARY KEY(event_id,card_id)
);
CREATE TABLE IF NOT EXISTS card_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merged_card_id uuid REFERENCES cards(id) ON DELETE SET NULL,
  source_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz
);
CREATE TABLE IF NOT EXISTS planner_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  proactive boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS focus_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(300) NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS focus_block_cards (
  focus_block_id uuid NOT NULL REFERENCES focus_blocks(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  PRIMARY KEY(focus_block_id,card_id)
);
CREATE TABLE IF NOT EXISTS planner_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text NOT NULL DEFAULT '',
  source varchar(24) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (ends_at > starts_at),
  CHECK (status IN ('pending','accepted','rejected'))
);
CREATE INDEX IF NOT EXISTS planner_suggestions_user_status_idx ON planner_suggestions(user_id,status,starts_at);
CREATE TABLE IF NOT EXISTS email_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  sender varchar(255),
  subject varchar(500),
  body text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
