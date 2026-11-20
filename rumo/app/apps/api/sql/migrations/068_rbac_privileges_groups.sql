CREATE TABLE access_permission_settings(permission_id text PRIMARY KEY,enabled boolean NOT NULL DEFAULT true);
CREATE TABLE access_groups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,permissions text[] NOT NULL DEFAULT '{}');
CREATE TABLE access_group_members(group_id uuid REFERENCES access_groups(id) ON DELETE CASCADE,user_id uuid REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(group_id,user_id));
CREATE TABLE access_user_exceptions(user_id uuid REFERENCES users(id) ON DELETE CASCADE,permission_id text NOT NULL,effect text NOT NULL CHECK(effect IN ('allow','deny')),PRIMARY KEY(user_id,permission_id));
CREATE TABLE workspace_members(workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,user_id uuid REFERENCES users(id) ON DELETE CASCADE,can_manage boolean NOT NULL DEFAULT false,PRIMARY KEY(workspace_id,user_id));
INSERT INTO workspace_members SELECT g.scope_id::uuid,g.user_id,bool_or(g.role_id='workspace_admin') FROM access_grants g JOIN workspaces w ON w.id::text=g.scope_id WHERE g.scope_type='workspace' GROUP BY g.scope_id,g.user_id ON CONFLICT DO NOTHING;
INSERT INTO workspace_members SELECT id,owner_id,true FROM workspaces ON CONFLICT DO NOTHING;
INSERT INTO access_roles(id,name,permissions) VALUES('administrator','Administrador',ARRAY['access.manage','plugins.manage']),('user','Usuário',ARRAY['boards.read']) ON CONFLICT DO NOTHING;
INSERT INTO access_grants(user_id,role_id) SELECT id,'user' FROM users WHERE NOT is_root ON CONFLICT DO NOTHING;
DELETE FROM access_grants WHERE scope_type='workspace';
CREATE OR REPLACE VIEW authorized_board_members AS
 SELECT b.id AS board_id,u.id AS user_id,CASE WHEN u.is_root THEN 'owner' ELSE COALESCE(m.role,'member') END AS role
 FROM boards b CROSS JOIN users u LEFT JOIN board_members m ON m.board_id=b.id AND m.user_id=u.id
 WHERE NOT u.disabled AND (u.is_root OR (b.workspace_id IS NULL AND m.user_id IS NOT NULL) OR EXISTS(SELECT 1 FROM access_grants g WHERE g.user_id=u.id AND g.scope_type='global' AND g.role_id IN ('administrator','platform_admin')) OR (
  b.workspace_id IS NOT NULL AND EXISTS(SELECT 1 FROM workspaces w JOIN workspace_members wm ON wm.workspace_id=w.id WHERE w.id=b.workspace_id AND wm.user_id=u.id AND w.archived_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM plugin_settings WHERE plugin_id='workspaces' AND NOT enabled)
 ));
