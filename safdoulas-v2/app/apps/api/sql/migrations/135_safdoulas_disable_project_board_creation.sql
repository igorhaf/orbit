-- SafDoulas uses the accreditation board supplied by its domain plugin.
INSERT INTO plugin_settings(plugin_id,enabled) VALUES('project-boards',false)
ON CONFLICT(plugin_id) DO UPDATE SET enabled=false;
