-- Preserve the current collection feature on existing Orbit installations.
INSERT INTO plugin_settings(plugin_id,enabled) VALUES('collections',true),('process-board',true) ON CONFLICT DO NOTHING;
UPDATE access_roles SET permissions=ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['plugin.collections.read'])) WHERE 'boards.read'=ANY(permissions);
UPDATE access_roles SET permissions=ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['plugin.collections.write'])) WHERE 'boards.write'=ANY(permissions);
UPDATE access_roles SET permissions=ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['plugin.process-board.read'])) WHERE 'views.structured.use'=ANY(permissions);

-- Shared reads (search, home, calendar and board events) honor plugin state and RBAC too.
CREATE OR REPLACE VIEW authorized_board_members AS
 SELECT b.id AS board_id,u.id AS user_id,CASE WHEN u.is_root THEN 'owner' ELSE COALESCE(m.role,'member') END AS role
 FROM boards b CROSS JOIN users u LEFT JOIN board_members m ON m.board_id=b.id AND m.user_id=u.id
 WHERE NOT u.disabled AND (u.is_root OR (b.workspace_id IS NULL AND m.user_id IS NOT NULL) OR (
  b.workspace_id IS NOT NULL AND EXISTS(SELECT 1 FROM workspaces w JOIN workspace_members wm ON wm.workspace_id=w.id WHERE w.id=b.workspace_id AND wm.user_id=u.id AND w.archived_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM plugin_settings WHERE plugin_id='workspaces' AND NOT enabled)
 )) AND (NOT b.is_collection OR (
  NOT EXISTS(SELECT 1 FROM plugin_settings WHERE plugin_id='collections' AND NOT enabled)
  AND (u.is_root OR (
    NOT EXISTS(SELECT 1 FROM access_permission_settings WHERE permission_id='plugin.collections.read' AND NOT enabled)
    AND NOT EXISTS(SELECT 1 FROM access_user_exceptions WHERE user_id=u.id AND permission_id='plugin.collections.read' AND effect='deny')
    AND (EXISTS(SELECT 1 FROM access_grants g JOIN access_roles r ON r.id=g.role_id WHERE g.user_id=u.id AND g.scope_type='global' AND g.scope_id='*' AND 'plugin.collections.read'=ANY(r.permissions))
      OR EXISTS(SELECT 1 FROM access_group_members gm JOIN access_groups g ON g.id=gm.group_id WHERE gm.user_id=u.id AND 'plugin.collections.read'=ANY(g.permissions))
      OR EXISTS(SELECT 1 FROM access_user_exceptions WHERE user_id=u.id AND permission_id='plugin.collections.read' AND effect='allow'))
  ))
 ));
