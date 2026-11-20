CREATE TABLE IF NOT EXISTS backup_cloud_settings (
  owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE RESTRICT,
  auto_upload boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vault_backup_cloud_copies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive text NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL CHECK (status IN ('uploading','success','failed')),
  folder_id text,
  archive_file_id text,
  manifest_file_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(archive,owner_id,connection_id)
);
CREATE INDEX IF NOT EXISTS vault_backup_cloud_copies_owner_idx ON vault_backup_cloud_copies(owner_id,created_at DESC);

CREATE TABLE IF NOT EXISTS vault_backup_restores (
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sha256 char(64) NOT NULL,
  item_count integer NOT NULL,
  restored_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,sha256)
);
