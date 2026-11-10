-- Remove only the optional Cofre module from this client instance.
-- Keep encrypted integration credentials, legacy privacy guards and historical backups.
INSERT INTO plugin_installations(plugin_id,installed) VALUES('vault',false)
 ON CONFLICT(plugin_id) DO UPDATE SET installed=false,updated_at=now();
INSERT INTO plugin_settings(plugin_id,enabled) VALUES('vault',false)
 ON CONFLICT(plugin_id) DO UPDATE SET enabled=false,updated_at=now();
