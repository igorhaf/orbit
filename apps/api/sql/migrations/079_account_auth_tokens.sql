ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT true;

CREATE TABLE account_auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('invite','verify','recover')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_auth_tokens_user_purpose ON account_auth_tokens(user_id,purpose,created_at DESC);

CREATE TABLE account_auth_limits (
  email_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  requests integer NOT NULL DEFAULT 0
);
