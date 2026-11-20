CREATE TABLE monitoring_alert_profiles (
  role_id text PRIMARY KEY REFERENCES access_roles(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  minimum_requests integer NOT NULL DEFAULT 20 CHECK (minimum_requests BETWEEN 1 AND 100000),
  failure_rate_percent numeric(5,2) NOT NULL DEFAULT 5 CHECK (failure_rate_percent BETWEEN 0 AND 100),
  route_latency_ms integer NOT NULL DEFAULT 2000 CHECK (route_latency_ms BETWEEN 1 AND 600000),
  queue_failures boolean NOT NULL DEFAULT true,
  backup_failures boolean NOT NULL DEFAULT true,
  outbound_mail_failures boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
