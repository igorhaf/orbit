CREATE TABLE request_rate_limits (
  bucket_hash text PRIMARY KEY CHECK (bucket_hash ~ '^[0-9a-f]{64}$'),
  request_count integer NOT NULL CHECK (request_count > 0),
  window_started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX request_rate_limits_updated_idx ON request_rate_limits(updated_at);
