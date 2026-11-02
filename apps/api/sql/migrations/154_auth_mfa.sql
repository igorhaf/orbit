ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS auth_mfa_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose varchar(16) NOT NULL CHECK (purpose IN ('login','enable','disable')),
  code_hash char(64) NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  session_version integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS auth_mfa_challenges_user_active_idx
  ON auth_mfa_challenges(user_id,purpose,created_at DESC) WHERE consumed_at IS NULL;
