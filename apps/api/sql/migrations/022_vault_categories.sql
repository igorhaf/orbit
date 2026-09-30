CREATE TABLE IF NOT EXISTS vault_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(48) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,name)
);
CREATE INDEX IF NOT EXISTS vault_categories_owner_idx ON vault_categories(owner_id,name);
