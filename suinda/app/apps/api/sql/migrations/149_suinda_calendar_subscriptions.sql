CREATE TABLE IF NOT EXISTS suinda_calendar_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_accessed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS suinda_calendar_subscriptions_one_active_idx
  ON suinda_calendar_subscriptions(owner_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS suinda_calendar_subscriptions_owner_idx
  ON suinda_calendar_subscriptions(owner_id, created_at DESC);
