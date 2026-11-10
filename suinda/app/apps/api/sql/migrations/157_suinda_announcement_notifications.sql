CREATE UNIQUE INDEX IF NOT EXISTS notifications_suinda_announcement_once_idx
  ON notifications(user_id,target_url)
  WHERE plugin_id='suinda-learning' AND kind='announcement';
