ALTER TABLE workspaces ADD COLUMN archived_at timestamptz;
INSERT INTO access_grants(user_id,role_id,scope_type,scope_id)
 SELECT owner_id,'workspace_admin','workspace',id::text FROM workspaces ON CONFLICT DO NOTHING;
INSERT INTO plugin_settings(plugin_id,enabled) VALUES('workspaces',true) ON CONFLICT DO NOTHING;
