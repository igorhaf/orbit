CREATE UNIQUE INDEX IF NOT EXISTS notifications_attendance_risk_once_idx
  ON notifications(user_id,target_url)
  WHERE plugin_id='suinda-learning' AND kind='attendance_risk';
