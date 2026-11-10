ALTER TABLE suinda_open_badge_credential_refs
  ADD COLUMN IF NOT EXISTS achievement_version smallint NOT NULL DEFAULT 1
  CHECK (achievement_version IN (1,2));
