CREATE TABLE IF NOT EXISTS suinda_whatsapp_notification_queue (
  notification_id uuid PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category varchar(40) NOT NULL CHECK (category IN ('academic_reminder','attendance_risk','study_group_message')),
  state varchar(16) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','skipped','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS suinda_whatsapp_notification_queue_pending_idx
  ON suinda_whatsapp_notification_queue(created_at,notification_id) WHERE state='pending';
