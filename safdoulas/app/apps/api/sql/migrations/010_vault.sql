CREATE TABLE IF NOT EXISTS vault_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(160) NOT NULL,
  category varchar(48) NOT NULL,
  notes text NOT NULL DEFAULT '',
  secret_data text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vault_items_owner_updated_idx ON vault_items(owner_id, updated_at DESC);
