-- Shared projection used by aggregate reads and realtime membership checks.
-- Persisted legacy memberships cannot reopen a revoked workspace scope.
CREATE VIEW authorized_board_members AS
 SELECT b.id AS board_id,u.id AS user_id,
 CASE WHEN u.is_root THEN 'owner' ELSE COALESCE(m.role,'member') END AS role
 FROM boards b CROSS JOIN users u
 LEFT JOIN board_members m ON m.board_id=b.id AND m.user_id=u.id
 WHERE NOT u.disabled AND (
  u.is_root OR (b.workspace_id IS NULL AND m.user_id IS NOT NULL) OR (
   b.workspace_id IS NOT NULL
   AND EXISTS(SELECT 1 FROM workspaces w WHERE w.id=b.workspace_id AND w.archived_at IS NULL)
   AND NOT EXISTS(SELECT 1 FROM plugin_settings WHERE plugin_id='workspaces' AND NOT enabled)
   AND EXISTS(SELECT 1 FROM access_grants g JOIN access_roles r ON r.id=g.role_id
    WHERE g.user_id=u.id AND g.scope_type='workspace' AND g.scope_id=b.workspace_id::text AND 'boards.read'=ANY(r.permissions))
  )
 );
