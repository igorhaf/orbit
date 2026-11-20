ALTER TABLE comments ADD COLUMN IF NOT EXISTS author_label text;

CREATE TABLE IF NOT EXISTS card_ai_comment_jobs (
  comment_id uuid PRIMARY KEY REFERENCES comments(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES ai_projects(id) ON DELETE RESTRICT,
  model varchar(100) NOT NULL,
  effort varchar(16) NOT NULL CHECK(effort IN ('low','medium','high','xhigh')),
  status varchar(16) NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','success','error')),
  answer_comment_id uuid REFERENCES comments(id) ON DELETE SET NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS card_ai_comment_jobs_queue_idx
  ON card_ai_comment_jobs(card_id,status,created_at);
