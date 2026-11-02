ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS notifications_workspace_email_idx
  ON notifications(workspace_id,plugin_id,kind,created_at DESC) WHERE workspace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS workspace_email_templates (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plugin_id varchar(80) NOT NULL,
  kind varchar(80) NOT NULL,
  subject_template varchar(250) NOT NULL,
  body_template text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,plugin_id,kind),
  CHECK (length(btrim(subject_template)) BETWEEN 1 AND 250),
  CHECK (length(btrim(body_template)) BETWEEN 1 AND 10000)
);
