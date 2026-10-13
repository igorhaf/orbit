-- Preserve profile edits; complete the permission declaration that was missing at bootstrap.
UPDATE access_roles SET permissions=array_append(permissions,'workspaces.read')
 WHERE id IN ('user','administrator','platform_admin') AND 'plugin.workspaces.read'=ANY(permissions) AND NOT 'workspaces.read'=ANY(permissions);
UPDATE access_roles SET permissions=array_append(permissions,'workspaces.write')
 WHERE id IN ('administrator','platform_admin') AND 'plugin.workspaces.write'=ANY(permissions) AND NOT 'workspaces.write'=ANY(permissions);
UPDATE access_roles SET permissions=array_append(permissions,'workspaces.manage')
 WHERE id IN ('administrator','platform_admin') AND 'plugin.workspaces.manage'=ANY(permissions) AND NOT 'workspaces.manage'=ANY(permissions);
