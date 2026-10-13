ALTER TABLE card_plugin_layouts ADD COLUMN card_type_id text;

CREATE TABLE card_type_settings (
  type_id text NOT NULL,
  scope_key text NOT NULL,
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(type_id,scope_key)
);

INSERT INTO card_type_settings(type_id,scope_key,enabled)
VALUES('software-development','*',true)
ON CONFLICT(type_id,scope_key) DO NOTHING;
