ALTER TABLE account_auth_tokens
  ADD COLUMN IF NOT EXISTS target_email text;

ALTER TABLE account_auth_tokens
  DROP CONSTRAINT IF EXISTS account_auth_tokens_purpose_check;

ALTER TABLE account_auth_tokens
  ADD CONSTRAINT account_auth_tokens_purpose_check
  CHECK (purpose IN ('invite','verify','recover','change-email'));

CREATE INDEX IF NOT EXISTS account_auth_tokens_target_email
  ON account_auth_tokens(lower(target_email))
  WHERE purpose='change-email' AND consumed_at IS NULL;
