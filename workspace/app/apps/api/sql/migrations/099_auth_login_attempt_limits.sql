CREATE TABLE auth_login_attempts (
  bucket_hash text PRIMARY KEY CHECK (bucket_hash ~ '^[0-9a-f]{64}$'),
  failure_count integer NOT NULL CHECK (failure_count > 0),
  window_started_at timestamptz NOT NULL,
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_login_attempts_updated_idx ON auth_login_attempts(updated_at);
