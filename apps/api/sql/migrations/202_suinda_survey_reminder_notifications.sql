CREATE UNIQUE INDEX IF NOT EXISTS notifications_suinda_survey_reminder_once_idx
  ON notifications(user_id,target_url,due_at)
  WHERE plugin_id='suinda-learning' AND kind='survey_reminder';
