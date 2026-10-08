CREATE TABLE IF NOT EXISTS attachment_backup_cloud_copies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive text NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE RESTRICT,
  source_kind varchar(8) NOT NULL CHECK (source_kind IN ('card','comment')),
  source_id uuid NOT NULL,
  card_id uuid NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('uploading','success','failed')),
  folder_id text,
  archive_file_id text,
  manifest_file_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(archive,owner_id,connection_id)
);
CREATE INDEX IF NOT EXISTS attachment_backup_cloud_copies_owner_idx ON attachment_backup_cloud_copies(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS attachment_backup_cloud_copies_source_idx ON attachment_backup_cloud_copies(owner_id,connection_id,source_kind,source_id,status);
