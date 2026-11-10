CREATE TABLE IF NOT EXISTS suinda_survey_reminder_policies (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  interval_hours integer NOT NULL DEFAULT 24 CHECK (interval_hours IN (1, 6, 12, 24, 48)),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
