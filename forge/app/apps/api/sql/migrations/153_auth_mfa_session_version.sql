ALTER TABLE auth_mfa_challenges ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;
