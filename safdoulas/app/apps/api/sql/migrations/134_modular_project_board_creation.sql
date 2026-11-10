-- Existing installations retain creation; explicit product choices are preserved.
INSERT INTO plugin_settings(plugin_id,enabled) VALUES('project-boards',true) ON CONFLICT DO NOTHING;
