ALTER TABLE notifications ADD COLUMN IF NOT EXISTS due_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_academic_reminder_once_idx
  ON notifications(user_id, target_url, due_at)
  WHERE plugin_id='suinda-learning' AND kind='academic_reminder';
