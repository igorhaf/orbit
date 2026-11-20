ALTER TABLE attachment_backup_cloud_copies ADD COLUMN IF NOT EXISTS folder_path text;
ALTER TABLE attachment_backup_cloud_copies ADD COLUMN IF NOT EXISTS organized_at timestamptz;
CREATE INDEX IF NOT EXISTS attachment_backup_cloud_copies_unorganized_idx ON attachment_backup_cloud_copies(owner_id,created_at) WHERE status='success' AND organized_at IS NULL;
