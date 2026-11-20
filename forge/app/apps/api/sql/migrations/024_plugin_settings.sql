CREATE TABLE IF NOT EXISTS plugin_settings (
  plugin_id varchar(100) PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
