CREATE TABLE IF NOT EXISTS auth_social_states (
  state_hash text PRIMARY KEY,
  provider varchar(80) NOT NULL,
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_social_states_expiry_idx ON auth_social_states(expires_at);

CREATE TABLE IF NOT EXISTS auth_social_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issuer text NOT NULL,
  subject text NOT NULL,
  email varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(issuer,subject),
  UNIQUE(user_id,issuer)
);
CREATE INDEX IF NOT EXISTS auth_social_identities_user_idx ON auth_social_identities(user_id);
