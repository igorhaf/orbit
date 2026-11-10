CREATE UNIQUE INDEX IF NOT EXISTS notifications_suinda_study_group_message_once_idx
  ON notifications(user_id,target_url)
  WHERE plugin_id='suinda-learning' AND kind='study_group_message';
