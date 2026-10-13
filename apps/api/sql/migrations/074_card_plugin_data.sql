ALTER TABLE card_plugin_layouts ADD COLUMN data jsonb NOT NULL DEFAULT '{}'::jsonb;
