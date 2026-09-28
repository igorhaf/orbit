CREATE TABLE IF NOT EXISTS github_webhook_deliveries (
  delivery_id varchar(100) PRIMARY KEY,
  event_name varchar(100) NOT NULL,
  action varchar(100),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text
);
CREATE INDEX IF NOT EXISTS github_webhook_deliveries_received_idx ON github_webhook_deliveries(received_at);
