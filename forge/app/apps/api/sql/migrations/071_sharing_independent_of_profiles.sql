-- Only ROOT bypasses sharing. Administrative RBAC profiles do not imply membership.
CREATE OR REPLACE VIEW authorized_board_members AS
 SELECT b.id AS board_id,u.id AS user_id,CASE WHEN u.is_root THEN 'owner' ELSE COALESCE(m.role,'member') END AS role
 FROM boards b CROSS JOIN users u LEFT JOIN board_members m ON m.board_id=b.id AND m.user_id=u.id
 WHERE NOT u.disabled AND (u.is_root OR (b.workspace_id IS NULL AND m.user_id IS NOT NULL) OR (
  b.workspace_id IS NOT NULL AND EXISTS(SELECT 1 FROM workspaces w JOIN workspace_members wm ON wm.workspace_id=w.id WHERE w.id=b.workspace_id AND wm.user_id=u.id AND w.archived_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM plugin_settings WHERE plugin_id='workspaces' AND NOT enabled)
 ));
