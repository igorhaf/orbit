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
CREATE TABLE IF NOT EXISTS checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  text varchar(300) NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  position double precision NOT NULL DEFAULT 0
);
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS assignee_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS due_date timestamptz;
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
CREATE UNIQUE INDEX IF NOT EXISTS notifications_due_once_idx ON notifications(user_id, card_id, kind) WHERE kind = 'due';
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id, created_at DESC);
